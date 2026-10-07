// Live emits timed fragments, not authoritative turns. UI grouping stays revisable.
export function mergeTranscript(rows, event, incremental = false) {
  if (
    incremental &&
    event.event_id &&
    rows.some((row) =>
      row.parts.some(
        (part) =>
          part.eventId === event.event_id ||
          part.eventIds?.includes(event.event_id),
      ),
    )
  )
    return rows;
  const role =
    event.type === "session.input_transcript.delta" ? "child" : "teacher";
  const start = Number(event.start_ms) || 0,
    end = Number(event.end_ms) || start;
  const next = rows.map((row) => ({ ...row, parts: [...row.parts] }));
  let row = next.find(
    (r) => r.role === role && r.parts.some((p) => p.start === start),
  );
  if (!row)
    row = [...next]
      .reverse()
      .find((r) => r.role === role && start >= r.start && start - r.end < 1200);
  if (!row) {
    row = { id: `${role}-${start}`, role, start, end, parts: [] };
    next.push(row);
  }
  const prior = row.parts.findIndex((p) => p.start === start);
  const fragment = {
    start,
    end,
    text: String(event.delta || ""),
    eventId: event.event_id,
  };
  if (incremental && prior >= 0) {
    fragment.text = row.parts[prior].text + fragment.text;
    fragment.eventIds = [
      ...(row.parts[prior].eventIds || [row.parts[prior].eventId]),
      event.event_id,
    ].filter(Boolean);
  }
  if (prior >= 0) row.parts[prior] = fragment;
  else if (
    !event.event_id ||
    !row.parts.some((p) => p.eventId === event.event_id)
  )
    row.parts.push(fragment);
  row.parts.sort((a, b) => a.start - b.start);
  row.start = Math.min(...row.parts.map((p) => p.start));
  row.end = Math.max(...row.parts.map((p) => p.end));
  row.text = row.parts.map((p) => p.text).join("");
  return next.sort((a, b) => a.start - b.start).slice(-200);
}
