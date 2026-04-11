function generateICS(meeting: any, slot: any) {
    const title = meeting.title || 'MCMS Meeting';
    const dateStr = slot?.date || meeting.confirmedDate || meeting.date;
    const timeStr = slot?.time || meeting.confirmedTime || meeting.time;
    const location = meeting.location || '';
    const joinUrl = meeting.meetingUrl || meeting.jitsiUrl || '';

    const startDate = parseDateTime(dateStr, timeStr);
    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

    const uid = `mcms-${meeting._id || meeting.id}@mcms.app`;

    const formatICSDate = (d: Date) => {
        return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    };

    const description = [
        meeting.modality ? `Type: ${meeting.modality}` : '',
        joinUrl ? `Join: ${joinUrl}` : '',
        location ? `Location: ${location}` : '',
    ].filter(Boolean).join('\\n');

    const ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//MCMS//Meeting//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:REQUEST',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTART:${formatICSDate(startDate)}`,
        `DTEND:${formatICSDate(endDate)}`,
        `SUMMARY:${title}`,
        `DESCRIPTION:${description}`,
        location ? `LOCATION:${location}` : '',
        joinUrl ? `URL:${joinUrl}` : '',
        `STATUS:CONFIRMED`,
        'END:VEVENT',
        'END:VCALENDAR',
    ].filter(Boolean).join('\r\n');

    return Buffer.from(ics, 'utf-8');
}

function parseDateTime(dateStr: string, timeStr: string) {
    if (!dateStr) return new Date();

    const datePart = new Date(dateStr + 'T00:00:00');
    if (!timeStr) return datePart;

    const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i);
    if (!match) return datePart;

    let h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    const ampm = (match[3] || '').toUpperCase();
    if (ampm === 'PM' && h < 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;

    datePart.setHours(h, m, 0, 0);
    return datePart;
}

export { generateICS };
