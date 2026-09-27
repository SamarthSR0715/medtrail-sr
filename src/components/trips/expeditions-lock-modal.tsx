import { Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface ExpeditionsLockModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExpeditionsLockModal({ open, onOpenChange }: ExpeditionsLockModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md text-center p-8 rounded-3xl border border-border/80 bg-background/95 backdrop-blur-xl shadow-2xl">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-500 mb-2">
          <Lock className="size-7" />
        </div>
        <DialogHeader className="text-center sm:text-center space-y-2">
          <DialogTitle className="font-display text-2xl font-bold tracking-tight text-foreground flex items-center justify-center gap-2">
            <span>🔒</span> MedTrail Expeditions
          </DialogTitle>
          <DialogDescription className="text-base text-muted-foreground pt-1">
            Adventure trips are currently under development.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex flex-col items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 border border-amber-500/30 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
            Coming Soon
          </span>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="mt-4 w-full rounded-full bg-secondary/80 hover:bg-secondary py-2.5 text-sm font-semibold text-foreground transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
