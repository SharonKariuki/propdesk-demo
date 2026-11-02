/** Words and badge tones for booking and payout states. */
export const STATUS_LABEL = { upcoming: "Upcoming", in_house: "In house", checked_out: "Checked out", cancelled: "Cancelled" } as const;
export const STATUS_TONE = { upcoming: "neutral", in_house: "info", checked_out: "vacant", cancelled: "coral" } as const;
export const PAYOUT_LABEL = { not_due: "Not yet paid out", awaiting_match: "Awaiting bank match", matched: "Matched to bank" } as const;
export const PAYOUT_TONE = { not_due: "neutral", awaiting_match: "ochre", matched: "paid" } as const;
