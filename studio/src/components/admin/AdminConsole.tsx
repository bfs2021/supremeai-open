import type { ChatMessage, Skill, Checkpoint, AdminSubTab, HealthMap } from '../../types';
import { LoginView } from './auth/AdminLogin';
import { AuthenticatedView } from './auth/AdminAuthenticated';
import DashboardErrorBoundary from './DashboardErrorBoundary';

// বাংলা (code-only gate): adminEmail/onAuthorize/recovery-জাতীয় সব prop সরানো
// হয়েছে — gate এখন শুধু ৬-ডিজিট authentication code চায়, bypass কোনো পথ নেই।

interface AdminConsoleProps {
  adminAuthenticated: boolean;
  adminError: string;
  handleAdminLogin: () => void;
  adminOtp: string;
  setAdminOtp: (val: string) => void;
  rememberBrowser: boolean;
  setRememberBrowser: (val: boolean) => void;
  actionStatus: string;
  skillQuery: string;
  setSkillQuery: (val: string) => void;
  skills: Skill[];
  handleInstallSkill: (name: string) => void;
  checkpoints: Checkpoint[];
  handleDeleteCheckpoint: (taskId: string) => void;
  adminSubTab: AdminSubTab;
  setAdminSubTab: (tab: AdminSubTab) => void;
  handleTriggerDeploy: () => void;
  adminMessages: ChatMessage[];
  loading: boolean;
  adminInput: string;
  setAdminInput: (val: string) => void;
  handleSendAdmin: () => void;
  rulesJson: string;
  setRulesJson: (val: string) => void;
  saveStatus: string;
  handleSaveRules: () => void;
  liveLogs: string[];
  setLiveLogs: (logs: string[]) => void;
  costReport: string;
  healthMap: HealthMap;
  newUsername: string;
  setNewUsername: (val: string) => void;
  newUserRole: string;
  setNewUserRole: (val: string) => void;
  newUserPerms: string;
  setNewUserPerms: (val: string) => void;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
}

export function AdminConsole(props: AdminConsoleProps) {
  // বাংলা (single-frontend migration): authenticated state-এ AuthenticatedView নিজেই
  // UnifiedAppShell (full-screen shell) বয়ে আনে — তাই বাইরের h-screen wrapper সরানো
  // হলো (nested full-screen হতো)। Login state-এ কোনো shell নেই, তাই সেখানেই
  // min-h-screen container + dashboard-aurora background দরকার।
  // Error boundary layering অপরিবর্তিত — দুই শাখাই DashboardErrorBoundary-র ভেতরে।
  if (props.adminAuthenticated) {
    return (
      <DashboardErrorBoundary>
        <AuthenticatedView {...props} />
      </DashboardErrorBoundary>
    );
  }
  return (
    <div className="dashboard-aurora min-h-screen w-full flex flex-col overflow-hidden">
      <DashboardErrorBoundary>
        <LoginView
          adminError={props.adminError}
          handleAdminLogin={props.handleAdminLogin}
          adminOtp={props.adminOtp}
          setAdminOtp={props.setAdminOtp}
          rememberBrowser={props.rememberBrowser}
          setRememberBrowser={props.setRememberBrowser}
        />
      </DashboardErrorBoundary>
    </div>
  );
}
