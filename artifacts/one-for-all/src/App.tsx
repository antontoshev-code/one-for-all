import { type ReactNode, type FC, type PropsWithChildren, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider as NextThemeProvider } from 'next-themes';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

import Home from '@/pages/home';
import Inbox from '@/pages/inbox';
import CategoryList from '@/pages/category-list';
import People from '@/pages/people';
import PersonDetail from '@/pages/person-detail';
import Settings from '@/pages/settings';
import Privacy from '@/pages/privacy';
import History from '@/pages/history';
import { AppNav } from '@/components/app-nav';
import Login from '@/pages/login';
import { getSession, type AuthUser } from '@/lib/auth-client';
import { Loader2 } from 'lucide-react';

/**
 * next-themes types its provider without `children`, and whether that is an
 * error depends on which @types/react instance pnpm resolves for it — which in
 * turn depends on the rest of the workspace. It typechecked here and failed on
 * Replit from the same lockfile. Naming the prop ourselves makes the component
 * mean the same thing everywhere instead of inheriting whatever resolution the
 * install happens to produce.
 */
const ThemeProvider = NextThemeProvider as FC<
  PropsWithChildren<{
    attribute?: string;
    defaultTheme?: string;
    enableSystem?: boolean;
    disableTransitionOnChange?: boolean;
  }>
>;

const queryClient = new QueryClient();

/**
 * Routes that must render without a session.
 *
 * The privacy policy is linked from the login screen, so gating it would mean
 * the only way to read what the app does with your data is to first hand it
 * some. It contains nothing personal, so there is nothing to protect.
 */
const PUBLIC_PATHS = ['/privacy'];

function Router() {
  const [location] = useLocation();
  // The nav loads entry counts, which 401 without a session. On a public page
  // that means a pointless failing request and a nav to places you can't go.
  const showNav = !PUBLIC_PATHS.includes(location);

  return (
    <RoutedErrorBoundary>
      <div className="relative min-h-screen bg-background text-foreground selection:bg-primary/20 selection:text-primary">
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/inbox" component={Inbox} />
          <Route path="/journal">
            {() => <CategoryList category="journal" title="Journal" description="Your daily notes and thoughts" />}
          </Route>
          <Route path="/tasks">
            {() => <CategoryList category="task" title="Tasks" description="Things you need to get done" />}
          </Route>
          <Route path="/ideas">
            {() => <CategoryList category="idea" title="Ideas" description="Concepts and potential projects" />}
          </Route>
          <Route path="/log">
            {() => <CategoryList category="log" title="Log" description="Record of activities and completed items" />}
          </Route>
          <Route path="/people" component={People} />
          <Route path="/people/:id" component={PersonDetail} />
          <Route path="/history" component={History} />
          <Route path="/settings" component={Settings} />
          <Route path="/privacy" component={Privacy} />
          <Route component={NotFound} />
        </Switch>
        {showNav && <AppNav />}
      </div>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

/**
 * Gates the app on a session.
 *
 * Every content route is 401 without one, so rendering the app first would
 * just flash a screen of failed requests. `user === undefined` means "not
 * checked yet" and is distinct from `null` ("checked, signed out") — without
 * that distinction the login form flashes on every refresh before the session
 * resolves.
 */

function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [location] = useLocation();

  const refresh = () => { void getSession().then(setUser); };
  useEffect(refresh, []);

  if (PUBLIC_PATHS.includes(location)) return <>{children}</>;

  if (user === undefined) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (user === null) return <Login onSignedIn={refresh} />;

  return <>{children}</>;
}

function App() {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {/* AuthGate sits inside the Router so the location it reads is
              base-relative — BASE_PATH is configurable, and comparing a
              base-prefixed path against '/privacy' would never match. */}
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <AuthGate>
              <Router />
            </AuthGate>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
