import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { searchIndex } from "@/lib/site-data";

export function SearchCommand() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const groups = [...new Set(searchIndex.map((i) => i.group))];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search MedTrail"
        className="glass group flex h-10 items-center gap-2 rounded-full px-3 text-sm text-muted-foreground transition-colors hover:text-foreground sm:w-52 sm:justify-between"
      >
        <span className="flex items-center gap-2">
          <Search className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Search…</span>
        </span>
        <kbd className="hidden rounded-md border border-border/70 bg-secondary/70 px-1.5 py-0.5 text-[10px] font-medium sm:inline">
          ⌘K
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search notes, treks, workouts…" />
        <CommandList>
          <CommandEmpty>Nothing found.</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup key={group} heading={group}>
              {searchIndex
                .filter((i) => i.group === group)
                .map((item) => (
                  <CommandItem
                    key={item.group + item.title}
                    value={`${item.title} ${item.keywords} ${item.group}`}
                    onSelect={() => {
                      setOpen(false);
                      void navigate({ to: item.to });
                    }}
                  >
                    {item.title}
                  </CommandItem>
                ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}