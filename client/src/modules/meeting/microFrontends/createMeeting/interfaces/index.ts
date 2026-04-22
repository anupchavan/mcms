export interface Suggestion {
  label: string;
  detail: string;
  date: Date;
}

export interface Slot {
  id: number;
  date: Date;
  display: string;
}

export interface MeetingFormData {
  title: string;
  description?: string;
  location?: string;
  duration: number;
  modality: "Online" | "Offline" | "Hybrid";
  timeSlots: Array<{ date: string; time: string }>;
  agenda?: Array<{ title: string; duration: number }>;
}

export interface ParticipantUser {
  _id: string;
  name: string;
  email: string;
  profileImage?: string;
}

export interface CreatedMeeting {
  title: string;
  date?: string;
  time?: string;
  meetingUrl?: string;
}

export interface MeetingCreationProps {
  onClose: () => void;
  onSubmit: (data: any) => Promise<any>;
}
