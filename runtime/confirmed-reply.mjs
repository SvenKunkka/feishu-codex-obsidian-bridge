export async function sendExactConfirmedReply({ wiki, question, matches, msg, channel, eligible, recalled,
  addWorkingReaction, scheduleWorkingReactionCleanup }) {
  if (!eligible || recalled()) return false;
  const match = matches.find(item => item.exact && (item.modelScope ?? item.model_scope) !== 'social_clip');
  if (!match) return false;
  // Re-read the selected file through the indexer's version checks just before sending.
  const fresh = (await wiki.search(question, 5)).find(item => item.exact && item.path === match.path && item.answer === match.answer);
  if (!fresh || recalled()) return false;
  const reaction = msg.socialWorkingReaction ?? addWorkingReaction(channel, msg.messageId);
  try {
    if (recalled()) return true;
    const uri = `obsidian://open?path=${encodeURIComponent(fresh.path)}`;
    await channel.send(msg.chatId, { markdown: `${fresh.answer}\n\n来源：[已确认笔记](${uri})` }, {
      replyTo: msg.messageId, ...(msg.threadId ? { replyInThread: true } : {})
    });
    return true;
  } catch (error) {
    if (recalled() || /230011|message was withdrawn/i.test(String(error?.message))) return true;
    throw error;
  } finally {
    if (msg.socialFinishReaction) msg.socialFinishReaction();
    else scheduleWorkingReactionCleanup(channel, msg.messageId, reaction);
  }
}
