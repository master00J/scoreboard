"use client";

import { useState } from "react";
import { sendCommand } from "@/lib/use-socket";
import { useDisplayStore } from "@/lib/store";
import { useLiveTimerSeconds } from "@/lib/use-timer";
import { formatTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function TimerPanel() {
  const state = useDisplayStore((s) => s.state);
  const elapsed = useLiveTimerSeconds();
  const running = !!state?.timerRunning;
  const [setOpen, setSetOpen] = useState(false);
  const [mm, setMm] = useState("0");
  const [ss, setSs] = useState("0");

  return (
    <div className="bg-card border border-border rounded-xl p-6 flex flex-col gap-4">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">
        Match Timer
      </div>
      <div
        className="text-center text-[96px] font-black tabular-nums leading-none"
        style={{ color: running ? "#22c55e" : "#f59e0b" }}
      >
        {formatTime(elapsed)}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="xl"
          variant={running ? "warning" : "success"}
          onClick={() => sendCommand({ type: running ? "timer:pause" : "timer:start" })}
        >
          {running ? "Pause" : "Start"}
        </Button>
        <Button
          size="xl"
          variant="outline"
          onClick={() => setSetOpen(true)}
        >
          Set time
        </Button>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <AdjustBtn label="-1m" delta={-60} />
        <AdjustBtn label="-10s" delta={-10} />
        <AdjustBtn label="+10s" delta={10} />
        <AdjustBtn label="+1m" delta={60} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" onClick={() => sendCommand({ type: "timer:preset", preset: "FIRST_HALF" })}>
          ⇤ 1st half (0:00)
        </Button>
        <Button variant="outline" size="sm" onClick={() => sendCommand({ type: "timer:preset", preset: "SECOND_HALF" })}>
          ⇤ 2nd half (45:00)
        </Button>
        <Button variant="outline" size="sm" onClick={() => sendCommand({ type: "timer:preset", preset: "ET1" })}>
          ⇤ ET1 (90:00)
        </Button>
        <Button variant="outline" size="sm" onClick={() => sendCommand({ type: "timer:preset", preset: "ET2" })}>
          ⇤ ET2 (105:00)
        </Button>
      </div>

      <Dialog open={setOpen} onOpenChange={setSetOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Set exact time</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              value={mm}
              onChange={(e) => setMm(e.target.value)}
              placeholder="Minutes"
            />
            <span className="text-2xl">:</span>
            <Input
              type="number"
              value={ss}
              onChange={(e) => setSs(e.target.value)}
              placeholder="Seconds"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSetOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                const seconds = Math.max(0, Number(mm) * 60 + Number(ss));
                sendCommand({ type: "timer:set", seconds });
                setSetOpen(false);
              }}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AdjustBtn({ label, delta }: { label: string; delta: number }) {
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => sendCommand({ type: "timer:adjust", deltaSec: delta })}
    >
      {label}
    </Button>
  );
}
