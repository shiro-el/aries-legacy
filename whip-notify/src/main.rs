use std::io::Read;
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};
use whip_notify::{
    Result,
    host::{NotificationPreview, Store, hostname, notification_preview, parse_event, renew_lease},
};

fn main() {
    if run().is_err() {
        // Never print event content, keys, relay capabilities, or provider errors.
        eprintln!(
            "whip-notify: operation failed (check installation, permissions, or relay availability)"
        );
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let mut command = args.next().ok_or("missing command")?;
    let (config, state) = if command == "--dirs" {
        let config = PathBuf::from(args.next().ok_or("missing config")?);
        let state = PathBuf::from(args.next().ok_or("missing state")?);
        command = args.next().ok_or("missing command")?;
        (config, state)
    } else {
        (
            PathBuf::from(std::env::var("HERDR_PLUGIN_CONFIG_DIR")?),
            PathBuf::from(std::env::var("HERDR_PLUGIN_STATE_DIR")?),
        )
    };
    let store = Store { config, state };
    match command.as_str() {
        "paths" => println!(
            "{}",
            serde_json::json!({"config":store.config,"state":store.state,"binary":std::env::current_exe()?,"protocol":1,"notification_previews":true,"notification_envelope_version":2})
        ),
        "identity" => {
            let key = store.identity()?;
            println!(
                "{}",
                serde_json::json!({"public_key":key.public_key,"host_id":whip_notify::key_id(&key.public_key)})
            );
        }
        "register" => {
            let mut input = Vec::new();
            std::io::stdin().take(16385).read_to_end(&mut input)?;
            if input.len() > 16384 {
                return Err("registration too large".into());
            }
            store.register(serde_json::from_slice(&input)?)?;
        }
        "unregister" => store.unregister(&args.next().ok_or("missing device")?)?,
        "lease" => {
            if args.next().as_deref() != Some("renew") {
                return Err("expected renew".into());
            }
            let device = args.next().ok_or("missing device")?;
            if !store.registrations()?.iter().any(|d| d.device_id == device) {
                return Err("unregistered device".into());
            }
            renew_lease(&store.state, &device)?;
        }
        "call" => {
            let call = whip_notify::calls::prepare(
                args,
                &std::env::var("HERDR_PANE_ID")?,
                &std::env::var("HERDR_SOCKET_PATH")?,
            )?;
            record_call(&store, &call);
            if call.event.urgency.as_deref() != Some("record") {
                push(
                    &store,
                    &call.event,
                    &NotificationPreview {
                        title: call.event.title.clone().unwrap_or_default(),
                        body: call.event.body.clone().unwrap_or_default(),
                    },
                )?;
            }
        }
        "reply" => {
            let id = args.next().ok_or("missing call id")?;
            let index: usize = args.next().ok_or("missing choice")?.parse()?;
            let pane = args.next().ok_or("missing pane")?;
            let session = args.next().ok_or("missing session")?;
            if args.next().is_some() {
                return Err("unexpected reply argument".into());
            }
            println!(
                "{}",
                serde_json::to_string(&whip_notify::calls::reply(
                    &store, &id, index, &pane, &session
                )?)?
            );
        }
        "policy" => {
            let value = args.next();
            if args.next().is_some() {
                return Err("unexpected policy argument".into());
            }
            if let Some(value) = value {
                store.set_hook_policy(&whip_notify::host::HookPolicy::parse(&value)?)?;
            }
            println!("{}", store.hook_policy()?.name());
        }
        "hook" => {
            let session = std::env::var("HERDR_SOCKET_PATH")?;
            let context =
                std::env::var("HERDR_PLUGIN_CONTEXT_JSON").unwrap_or_else(|_| "{}".into());
            let json = std::env::var("HERDR_PLUGIN_EVENT_JSON")?;
            if let Some(mut event) = parse_event(&json, &context, &session)? {
                let preview = notification_preview(&event, &json, &context, &hostname())?;
                if store.hook_policy()? == whip_notify::host::HookPolicy::AllPanes {
                    return push(&store, &event, &preview);
                }
                if event.status != "blocked" {
                    return Ok(());
                }
                let (workspace, eligible) =
                    whip_notify::calls::main_agent(&event.pane_id, &session);
                if !eligible || workspace != event.workspace_id {
                    return Ok(());
                }
                event.kind = Some("approval".into());
                event.urgency = Some("urgent".into());
                event.title = Some(preview.title.clone());
                event.body = Some(preview.body.clone());
                event.call_id = Some(uuid::Uuid::new_v4().to_string());
                record_call(
                    &store,
                    &whip_notify::calls::CallRecord {
                        event: event.clone(),
                        created_at: std::time::SystemTime::now()
                            .duration_since(std::time::SystemTime::UNIX_EPOCH)?
                            .as_secs(),
                        requested_urgency: "urgent".into(),
                        ineligible_reason: None,
                        reply: None,
                        reply_status: None,
                    },
                );
                push(&store, &event, &preview)?;
            }
        }
        "uninstall" => {
            // Explicit administrator operation, after globally unlinking in Herdr.
            let _lock = store.lock()?;
            for device in store.registrations()? {
                let _ = std::fs::remove_file(store.state.join("leases").join(device.device_id));
            }
            for name in ["devices.json", "identity.json"] {
                let _ = std::fs::remove_file(store.config.join(name));
            }
        }
        _ => return Err("unknown command".into()),
    }
    Ok(())
}

// History is best effort for new events. Reply claims still require durable
// recording before any input can be sent, to preserve at-most-once delivery.
fn record_call(store: &Store, call: &whip_notify::calls::CallRecord) {
    if whip_notify::calls::record(store, call).is_err() {
        eprintln!("whip-notify: could not record call history");
    }
}

fn push(
    store: &Store,
    event: &whip_notify::NotificationEvent,
    preview: &NotificationPreview,
) -> Result<()> {
    let deadline = Instant::now() + Duration::from_secs(4);
    whip_notify::host::deliver(store, event, &|device, envelope| {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .ok_or("push deadline")?;
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(remaining))
            .max_redirects(0)
            .build()
            .into();
        let mut request = device.push_request(envelope, preview);
        if event.kind.is_some() {
            request.preview = None;
        }
        agent
            .post(format!("{}/v1/push", device.relay_url))
            .header("Authorization", format!("Bearer {}", device.route_token))
            .send_json(request)?;
        Ok(())
    })?;
    Ok(())
}
