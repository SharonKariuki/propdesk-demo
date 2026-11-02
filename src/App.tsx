import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import AuthLayout from "@/components/AuthLayout";
import ProtectedRoute from "@/components/ProtectedRoute";
import RequirePermission from "@/components/RequirePermission";
import DashboardPage from "@/pages/DashboardPage";
import LoginPage from "@/pages/LoginPage";
import NotFoundPage from "@/pages/NotFoundPage";
import PasswordResetPage from "@/pages/PasswordResetPage";
import PasswordResetConfirmPage from "@/pages/PasswordResetConfirmPage";

// Pages other than sign-in and Home load on first visit, keeping the first download small.
const AccountingPage = lazy(() => import("@/pages/AccountingPage"));
const ActivityPage = lazy(() => import("@/pages/ActivityPage"));
const BuildingDetailPage = lazy(() => import("@/pages/BuildingDetailPage"));
const BuildingsPage = lazy(() => import("@/pages/BuildingsPage"));
const AddBuildingPage = lazy(() => import("@/pages/AddBuildingPage"));
const DepositsPage = lazy(() => import("@/pages/DepositsPage"));
const EditBuildingPage = lazy(() => import("@/pages/EditBuildingPage"));
const ExpensesPage = lazy(() => import("@/pages/ExpensesPage"));
const ManualIncomePage = lazy(() => import("@/pages/ManualIncomePage"));
const NotificationsPage = lazy(() => import("@/pages/NotificationsPage"));
const PaymentsPage = lazy(() => import("@/pages/PaymentsPage"));
const ReconciliationPage = lazy(() => import("@/pages/ReconciliationPage"));
const ReportsPage = lazy(() => import("@/pages/ReportsPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const ShortStayPage = lazy(() => import("@/pages/ShortStayPage"));
const TaxPage = lazy(() => import("@/pages/TaxPage"));
const AddChargePage = lazy(() => import("@/pages/AddChargePage"));
const AddCreditPage = lazy(() => import("@/pages/AddCreditPage"));
const RefundCreditPage = lazy(() => import("@/pages/RefundCreditPage"));
const TenantDetailPage = lazy(() => import("@/pages/TenantDetailPage"));
const TenantsPage = lazy(() => import("@/pages/TenantsPage"));
const UnitsPage = lazy(() => import("@/pages/UnitsPage"));
const WaterReadingsPage = lazy(() => import("@/pages/WaterReadingsPage"));

export default function App() {
  return (
    <Suspense fallback={<div className="p-8 text-[13px] text-content-muted" role="status">Loading…</div>}>
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<PasswordResetPage />} />
      <Route path="/reset-password/confirm/:token" element={<PasswordResetConfirmPage />} />

      <Route
        element={
          <ProtectedRoute>
            <AuthLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/buildings" element={<RequirePermission permission="buildings.view"><BuildingsPage /></RequirePermission>} />
        <Route path="/buildings/new" element={<RequirePermission permission="buildings.manage"><AddBuildingPage /></RequirePermission>} />
        <Route path="/buildings/:id" element={<RequirePermission permission="buildings.view"><BuildingDetailPage /></RequirePermission>} />
        <Route path="/buildings/:id/edit" element={<RequirePermission permission="buildings.manage"><EditBuildingPage /></RequirePermission>} />
        <Route path="/units" element={<RequirePermission permission="buildings.view"><UnitsPage /></RequirePermission>} />
        <Route path="/short-stay" element={<RequirePermission permission="buildings.view"><ShortStayPage /></RequirePermission>} />
        <Route path="/deposits" element={<RequirePermission permission="payments.view"><DepositsPage /></RequirePermission>} />
        <Route path="/tax" element={<RequirePermission permission="accounting.view"><TaxPage /></RequirePermission>} />
        <Route path="/tenants" element={<RequirePermission permission="tenants.view"><TenantsPage /></RequirePermission>} />
        <Route path="/tenants/:id" element={<RequirePermission permission="tenants.view"><TenantDetailPage /></RequirePermission>} />
        <Route path="/tenants/:id/charges/new" element={<RequirePermission permission="charges.add"><AddChargePage /></RequirePermission>} />
        <Route path="/tenants/:id/credits/new" element={<RequirePermission permission="credits.manage"><AddCreditPage /></RequirePermission>} />
        <Route path="/tenants/:id/credits/refund" element={<RequirePermission permission="credits.manage"><RefundCreditPage /></RequirePermission>} />
        <Route path="/payments" element={<RequirePermission permission="payments.view"><PaymentsPage /></RequirePermission>} />
        <Route path="/reconciliation" element={<RequirePermission permission="reconciliation.manage"><ReconciliationPage /></RequirePermission>} />
        <Route path="/expenses" element={<RequirePermission permission="expenses.view"><ExpensesPage /></RequirePermission>} />
        <Route path="/income" element={<RequirePermission permission="income.view"><ManualIncomePage /></RequirePermission>} />
        <Route path="/water" element={<RequirePermission permission="water.view"><WaterReadingsPage /></RequirePermission>} />
        <Route path="/accounting" element={<RequirePermission permission="accounting.view"><AccountingPage /></RequirePermission>} />
        <Route path="/notifications" element={<RequirePermission permission="notifications.view"><NotificationsPage /></RequirePermission>} />
        <Route path="/reports" element={<RequirePermission permission="reports.view"><ReportsPage /></RequirePermission>} />
        <Route path="/activity" element={<RequirePermission permission="activity.view"><ActivityPage /></RequirePermission>} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      {/* Public catch-all: a logged-out user hitting a bad URL should see
          NotFound, not get bounced to /login by ProtectedRoute. */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    </Suspense>
  );
}
