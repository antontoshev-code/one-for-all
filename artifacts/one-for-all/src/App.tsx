import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
import History from '@/pages/history';
import { AppNav } from '@/components/app-nav';

const queryClient = new QueryClient();

function Router() {
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
          <Route component={NotFound} />
        </Switch>
        <AppNav />
      </div>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
