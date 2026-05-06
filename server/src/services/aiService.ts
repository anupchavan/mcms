const _rawUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
const AI_SERVICE_URL = _rawUrl.replace(/\/+$/, '');

async function callAISummarize(transcriptSegments: any[], agendaItems: any[]) {
	try {
		const resp = await fetch(`${AI_SERVICE_URL}/summarize`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ segments: transcriptSegments, agenda_items: agendaItems }),
		});
		if (!resp.ok) {
			const errText = await resp.text().catch(() => '');
			throw new Error(`AI req failed ${resp.status}: ${errText}`);
		}
		const data: any = await resp.json();
		return data.summaries || {};
	} catch (error: any) {
		console.error('AI summarize call failed:', error.message);
		throw error;
	}
}

async function callAIExtractActions(transcriptText: string, minutesItems: any[] = []) {
	try {
		const resp = await fetch(`${AI_SERVICE_URL}/extract-actions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text: transcriptText, minutes_items: minutesItems }),
		});
		if (!resp.ok) {
			const errText = await resp.text().catch(() => '');
			throw new Error(`AI req failed ${resp.status}: ${errText}`);
		}
		const data: any = await resp.json();
		return data.actions || [];
	} catch (error: any) {
		console.error('AI extract-actions call failed:', error.message);
		throw error;
	}
}

async function callAIMeetingSummary(payload: {
	meeting_title?: string;
	segments: any[];
	agenda_items?: any[];
	minutes_items?: any[];
	action_items?: any[];
}) {
	try {
		const resp = await fetch(`${AI_SERVICE_URL}/meeting-summary`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});
		if (!resp.ok) {
			const errText = await resp.text().catch(() => '');
			throw new Error(`AI req failed ${resp.status}: ${errText}`);
		}
		const data: any = await resp.json();
		return data.summary || {};
	} catch (error: any) {
		console.error('AI meeting-summary call failed:', error.message);
		throw error;
	}
}

async function callAIExtractTags(transcriptText: string) {
	try {
		const resp = await fetch(`${AI_SERVICE_URL}/extract-tags`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text: transcriptText }),
		});
		if (!resp.ok) {
			const errText = await resp.text().catch(() => '');
			throw new Error(`AI req failed ${resp.status}: ${errText}`);
		}
		const data: any = await resp.json();
		return data.tags || [];
	} catch (error: any) {
		console.error('AI extract-tags call failed:', error.message);
		throw error;
	}
}

async function callAISentiment(text: string) {
	try {
		const resp = await fetch(`${AI_SERVICE_URL}/sentiment`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text }),
		});
		if (!resp.ok) throw new Error(`AI service returned ${resp.status}`);
		return await resp.json();
	} catch (error: any) {
		console.error('AI sentiment call failed:', error.message);
		throw error;
	}
}

export { callAISummarize, callAIExtractActions, callAIMeetingSummary, callAISentiment, callAIExtractTags };
