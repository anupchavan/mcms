import { useOutletContext } from "react-router-dom";
import type { DashboardLayoutContext } from "../layouts/DashboardLayout";

/** Typed accessor for the shared state provided by `DashboardLayout`. */
export default function useDashboardContext(): DashboardLayoutContext {
    return useOutletContext<DashboardLayoutContext>();
}
