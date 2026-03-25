export type PlannerMode = "auto" | "manual";

export interface UiShellProps {
  tripName: string;
  mode: PlannerMode;
  paused: boolean;
}

export function UiShell(_props: UiShellProps) {
  // Step 1 placeholder. React mount and full panel logic come in Step 2.
  return null;
}