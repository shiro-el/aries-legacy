//! Words from the draft and recent chat that steer speech recognition toward
//! the identifiers, paths, and English terms the user is likely to say.

use std::collections::HashMap;

const MAX_HINTS: usize = 100;
const MAX_SOURCE_CHARACTERS: usize = 12_000;
const MAX_HINT_CHARACTERS: usize = 80;
const WORDS_PER_HINT: usize = 4;

struct ContextHint {
    text: String,
    frequency: usize,
    in_draft: bool,
    order: usize,
}

/// Rank all candidates by frequency; ties prefer the draft, then recent context.
#[uniffi::export]
pub fn transcription_context(draft: String, recent_text: Vec<String>) -> Vec<String> {
    let mut hints = HashMap::new();
    count_hints(&draft, true, &mut hints);
    for text in recent_text.iter().rev() {
        count_hints(text, false, &mut hints);
    }
    let mut ranked: Vec<_> = hints.into_values().collect();
    ranked.sort_unstable_by(|left, right| {
        right
            .frequency
            .cmp(&left.frequency)
            .then_with(|| right.in_draft.cmp(&left.in_draft))
            .then_with(|| left.order.cmp(&right.order))
    });
    ranked
        .into_iter()
        .take(MAX_HINTS)
        .map(|hint| hint.text)
        .collect()
}

fn count_hints(text: &str, in_draft: bool, hints: &mut HashMap<String, ContextHint>) {
    let start = text
        .char_indices()
        .rev()
        .nth(MAX_SOURCE_CHARACTERS - 1)
        .map_or(0, |(i, _)| i);
    for line in text[start..].lines().rev() {
        let words: Vec<_> = line
            .split(|c: char| {
                !c.is_alphanumeric() && !matches!(c, '_' | '-' | '.' | '/' | '\\' | '@')
            })
            .map(|word| word.trim_matches(|c: char| !c.is_alphanumeric()))
            .filter(|word| {
                let length = word.chars().count();
                (2..=MAX_HINT_CHARACTERS).contains(&length) && word.chars().any(char::is_alphabetic)
            })
            .collect();
        for chunk in words.chunks(WORDS_PER_HINT).filter(|chunk| chunk.len() > 1) {
            count_hint(chunk.join(" "), in_draft, hints);
        }
        for word in words {
            count_hint(word.to_owned(), in_draft, hints);
        }
    }
}

fn count_hint(hint: String, in_draft: bool, hints: &mut HashMap<String, ContextHint>) {
    if hint.chars().count() > MAX_HINT_CHARACTERS {
        return;
    }
    let order = hints.len();
    let candidate = hints.entry(hint.to_lowercase()).or_insert(ContextHint {
        text: hint,
        frequency: 0,
        in_draft,
        order,
    });
    candidate.frequency += 1;
    candidate.in_draft |= in_draft;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hints_are_ranked_by_frequency_across_draft_and_context() {
        let context = transcription_context(
            "DraftOnly Shared".into(),
            vec!["popular shared\npopular".into(), "POPULAR\nrecent".into()],
        );
        assert_eq!(&context[..2], ["POPULAR", "Shared"]);
        assert!(context.contains(&"DraftOnly".into()));
        assert_eq!(
            context
                .iter()
                .filter(|hint| hint.eq_ignore_ascii_case("popular"))
                .count(),
            1
        );
    }

    #[test]
    fn frequency_ties_prefer_draft_then_recent_context() {
        let context = transcription_context("Draft".into(), vec!["older".into(), "newer".into()]);
        assert_eq!(context, ["Draft", "newer", "older"]);
    }

    #[test]
    fn single_word_chunks_do_not_double_count_occurrences() {
        let context = transcription_context(String::new(), vec!["phrase phrase\nsolo".into()]);
        assert_eq!(context[0], "phrase");
    }

    #[test]
    fn all_candidates_are_counted_before_selecting_the_top_100_hints() {
        let identifiers = (0..130)
            .map(|i| format!("identifier{i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let context = transcription_context(
            "draft".into(),
            vec![format!("frequent\nfrequent\n{identifiers}")],
        );
        assert_eq!(context.len(), 100);
        assert_eq!(&context[..3], ["frequent", "draft", "identifier129"]);
    }

    #[test]
    fn hints_preserve_paths_and_obey_character_limits() {
        let long = "a".repeat(MAX_HINT_CHARACTERS + 1);
        let context = transcription_context(
            "Fix WhipSsh and expo-speech-recognition".into(),
            vec![format!(
                "WhipSsh src/components/MessageComposer.tsx\n{long}"
            )],
        );
        assert!(context.contains(&"src/components/MessageComposer.tsx".into()));
        assert!(!context.contains(&long));
        assert!(
            context
                .iter()
                .all(|hint| hint.chars().count() <= MAX_HINT_CHARACTERS)
        );
    }

    #[test]
    fn unicode_context_is_preserved_and_empty_context_is_usable() {
        assert!(
            transcription_context("修正語音輸入".into(), vec![]).contains(&"修正語音輸入".into())
        );
        assert!(transcription_context(String::new(), vec!["1234 ###".into()]).is_empty());
    }
}
