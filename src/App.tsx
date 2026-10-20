import { Navigate, Route, Routes } from "react-router-dom";

import AuthLayout from "@/components/AuthLayout";
import ProtectedRoute from "@/components/ProtectedRoute";
import RequirePermission from "@/components/RequirePermission";
import AccountingPage from "@/pages/AccountingPage";
import ActivityPage from "@/pages/ActivityPage";
import BuildingDetailPage from "@/pages/BuildingDetailPage";
import BuildingsPage from "@/pages/BuildingsPage";
import AddBuildingPage from "@/pages/AddBuildingPage";
import DashboardPage from "@/pages/DashboardPage";
import EditBuildingPage from "@/pages/EditBuildingPage";
import ExpensesPage from "@/pages/ExpensesPage";
import ManualIncomePage from "@/pages/ManualIncomePage";
import LoginPage from "@/pages/LoginPage";
import NotFoundPage from "@/pages/NotFoundPage";
import NotificationsPage from "@/pages/NotificationsPage";
import PasswordResetPage from "@/pages/PasswordResetPage";
import PasswordResetConfirmPage from "@/pages/PasswordResetConfirmPage";
import PaymentsPage from "@/pages/PaymentsPage";
import ReconciliationPage from "@/pages/ReconciliationPage";
import ReportsPage from "@/pages/ReportsPage";
import SettingsPage from "@/pages/SettingsPage";
import AddChargePage from "@/pages/AddChargePage";
import AddCreditPage from "@/pages/AddCreditPage";
import RefundCreditPage from "@/pages/RefundCreditPage";
import TenantDetailPage from "@/pages/TenantDetailPage";
import TenantsPage from "@/pages/TenantsPage";
import UnitsPage from "@/pages/UnitsPage";
import WaterReadingsPage from "@/pages/WaterReadingsPage";

export default function App() {
  return (
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
  );
}
