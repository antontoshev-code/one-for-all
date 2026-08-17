import { Link, useLocation } from "wouter";
import { Home, Inbox, Book, CheckSquare, MoreHorizontal, Lightbulb, Activity, Users, Settings } from "lucide-react";
import { useGetEntryStats } from "@workspace/api-client-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function AppNav() {
  const [location] = useLocation();
  const { data: stats } = useGetEntryStats();
  
  const navItems = [
    { href: "/", label: "Home", icon: Home },
    { href: "/inbox", label: "Inbox", icon: Inbox, count: stats?.inbox },
    { href: "/journal", label: "Journal", icon: Book },
    { href: "/tasks", label: "Tasks", icon: CheckSquare },
  ];

  const moreItems = [
    { href: "/ideas", label: "Ideas", icon: Lightbulb },
    { href: "/log", label: "Log", icon: Activity },
    { href: "/people", label: "People", icon: Users },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 border-t border-border/50 bg-background/80 backdrop-blur-xl pb-safe z-40">
      <div className="flex h-16 items-center justify-around px-2 max-w-md mx-auto w-full">
        {navItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href} className="relative flex flex-col items-center justify-center w-16 h-full text-muted-foreground hover:text-foreground transition-colors group">
              <div className={cn("p-1.5 rounded-full transition-colors", isActive ? "bg-primary/10 text-primary" : "group-hover:bg-muted")}>
                <item.icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
              </div>
              <span className={cn("text-[10px] font-medium mt-0.5", isActive ? "text-primary" : "")}>{item.label}</span>
              {!!item.count && item.count > 0 && (
                <span className="absolute top-1 right-2 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground">
                  {item.count}
                </span>
              )}
            </Link>
          );
        })}
        
        <Popover>
          <PopoverTrigger className="relative flex flex-col items-center justify-center w-16 h-full text-muted-foreground hover:text-foreground transition-colors group">
            <div className="p-1.5 rounded-full transition-colors group-hover:bg-muted">
              <MoreHorizontal className="h-5 w-5" strokeWidth={2} />
            </div>
            <span className="text-[10px] font-medium mt-0.5">More</span>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2 mb-2 rounded-3xl" side="top" align="end">
            <div className="flex flex-col gap-1">
              {moreItems.map((item) => (
                <Link key={item.href} href={item.href} className="flex items-center gap-3 px-4 py-3 rounded-2xl hover:bg-muted transition-colors">
                  <item.icon className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm font-medium">{item.label}</span>
                </Link>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </nav>
  );
}
