import Agenda = require('../modules/agenda/agenda.schema');
import ActionItem = require('../modules/action-item/action-item.schema');

async function generateBrief(meeting: any, callAISummarize: any) {
    const agenda = await Agenda.findOne({ meetingId: meeting._id });
    const agendaItems = agenda ? (agenda as any).items : [];

    const pendingActions = await ActionItem.find({
        status: { $in: ['pending', 'in-progress', 'completed'] },
    }).sort({ createdAt: -1 }).limit(5).populate('assignee', 'name');

    const context = {
        meetingTitle: meeting.title,
        meetingDate: meeting.confirmedDate || meeting.date,
        meetingTime: meeting.confirmedTime || meeting.time,
        agendaItems: agendaItems.map((i: any) => ({ title: i.title, duration: i.duration })),
        pendingActions: pendingActions.map((a: any) => ({
            title: a.title,
            assignee: a.assigneeName || a.assignee?.name || 'Unassigned',
            status: a.status,
            deadline: a.deadline,
        })),
    };

    let aiSummary: any = null;
    if (callAISummarize) {
        try {
            aiSummary = await callAISummarize(
                [{ text: JSON.stringify(context), speaker: 'system' }],
                agendaItems.map((i: any) => ({ id: i.id, title: i.title }))
            );
        } catch (e) {
            // AI service not available, fallback below
        }
    }

    const agendaList = agendaItems.length > 0
        ? agendaItems.map((item: any, idx: number) => `${idx + 1}. ${item.title} (${item.duration} min)`).join('\n')
        : 'No agenda items set yet.';

    const actionList = pendingActions.length > 0
        ? pendingActions.map((a: any) => `- ${a.title} (${(a as any).assigneeName || (a as any).assignee?.name || 'Unassigned'}) — ${a.status}`).join('\n')
        : 'No pending action items.';

    return {
        meetingTitle: meeting.title,
        date: context.meetingDate,
        time: context.meetingTime,
        agendaSummary: agendaList,
        pendingActionsSummary: actionList,
        aiSummary: aiSummary || null,
    };
}

function formatBriefEmail(brief: any, meetingId: any, clientUrl: string) {
    const agendaLink = `${clientUrl}/#meeting-${meetingId}`;
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a2e">
  <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:24px;border-radius:12px 12px 0 0;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:20px">Pre-Meeting Brief</h1>
  </div>
  <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    <h2 style="margin:0 0 8px;color:#1a1a2e">${brief.meetingTitle}</h2>
    <p style="color:#6b7280">${brief.date || 'TBD'} at ${brief.time || 'TBD'}</p>

    <h3 style="margin:20px 0 8px;color:#4f46e5">Agenda</h3>
    <pre style="background:#f9fafb;padding:12px;border-radius:8px;font-size:13px;white-space:pre-wrap">${brief.agendaSummary}</pre>

    <h3 style="margin:20px 0 8px;color:#4f46e5">Pending Action Items</h3>
    <pre style="background:#f9fafb;padding:12px;border-radius:8px;font-size:13px;white-space:pre-wrap">${brief.pendingActionsSummary}</pre>

    ${brief.aiSummary ? `<h3 style="margin:20px 0 8px;color:#4f46e5">AI Summary</h3>
    <p style="font-size:14px">${JSON.stringify(brief.aiSummary)}</p>` : ''}

    <div style="margin-top:24px;text-align:center">
      <a href="${agendaLink}" style="display:inline-block;padding:10px 28px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">View Agenda</a>
    </div>
  </div>
</body></html>`;
}

export { generateBrief, formatBriefEmail };
