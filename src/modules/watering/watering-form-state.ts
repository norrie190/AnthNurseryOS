export const initialRecordWateringValues = { wateredAt: '', notes: '' };
export const initialScheduleValues = { intervalDays: '', effectiveFrom: '', notes: '' };

export type RecordWateringField = keyof typeof initialRecordWateringValues;
export type ScheduleField = keyof typeof initialScheduleValues;

export type WateringFormState<Fields extends string> = {
  success: boolean;
  message: string;
  fieldErrors: Partial<Record<Fields, string>>;
};

export type RecordWateringFormState = WateringFormState<RecordWateringField>;
export type ScheduleFormState = WateringFormState<ScheduleField>;

export const initialRecordWateringState: RecordWateringFormState = {
  success: false,
  message: '',
  fieldErrors: {},
};
export const initialScheduleState: ScheduleFormState = {
  success: false,
  message: '',
  fieldErrors: {},
};
