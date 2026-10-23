// parents: @.frostline/graph/v-m-read-classifier.xml

use read_classifier::classify_reads;

#[test]
fn cat_yields_the_read_path() {
    assert_eq!(classify_reads("cat /tmp/a.txt"), vec!["/tmp/a.txt"]);
}

#[test]
fn reads_are_deduplicated_in_first_seen_order() {
    // Upstream `parse_command` reports at most one path per command.
    assert_eq!(
        classify_reads("cat /b.txt; cat /a.txt; cat /a.txt"),
        vec!["/b.txt", "/a.txt"]
    );
}

#[test]
fn non_read_commands_yield_nothing() {
    assert!(classify_reads("echo hello > /tmp/out.txt").is_empty());
    assert!(classify_reads("printf '%s' x").is_empty());
}

#[test]
fn empty_script_yields_nothing() {
    assert!(classify_reads("").is_empty());
}
