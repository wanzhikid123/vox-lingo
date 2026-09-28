import { t as tr } from "./i18n.js";
import { api } from "./api.js";
export async function confirmTopicDeletion(topic, turnId = null) {
  if (
    !window.confirm(
      tr("deleteTopic", {
        name: topic.name,
      }),
    )
  )
    return false;
  await api(`/topics/${encodeURIComponent(topic.id)}/delete`, {
    expectedRevision: topic.revision,
    confirmed: true,
    turnId,
  });
  return true;
}
