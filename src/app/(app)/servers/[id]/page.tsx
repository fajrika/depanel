"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import ServerMonitor from "@/components/ServerMonitor";

export default function ServerMonitorPage() {
  const { id } = useParams<{ id: string }>();
  const [managed, setManaged] = useState(false);

  useEffect(() => {
    fetch("/api/servers")
      .then((r) => r.json())
      .then((d) => {
        const s = (d.data ?? []).find((x: { id: string }) => x.id === id);
        if (s) setManaged(s.managed);
      })
      .catch(() => {});
  }, [id]);

  return (
    <div>
      <Link href="/" className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
        ← kembali ke daftar server
      </Link>
      <div className="mt-2">
        <ServerMonitor serverId={id} managed={managed} />
      </div>
    </div>
  );
}
