import QRCode from "qrcode";
import { bestLanUrl, lanAddresses } from "@/lib/lan";
import { Card, Chip, Eyebrow, PageTitle } from "@/components/ui";

// The address depends on the network the laptop is on, so this can never be
// prerendered — it has to be read at request time.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function audienceTarget(override?: string): string | null {
  if (!override) return bestLanUrl("/live");
  try {
    const url = new URL(override);
    if (url.pathname === "/") url.pathname = "/live";
    return url.toString();
  } catch {
    return override;
  }
}

/**
 * A scannable link to the read-only audience board, sized for a projector.
 *
 * `?url=` overrides the detected address. That is the escape hatch for a public
 * tunnel (cloudflared / ngrok): paste the https URL and the code re-encodes, so
 * phones on cellular can reach it without touching the venue network.
 */
export default async function QrPage({
  searchParams,
}: {
  searchParams: { url?: string };
}) {
  const override = searchParams.url?.trim();
  const target = audienceTarget(override);
  const addresses = lanAddresses();
  const isTunnel = Boolean(override);

  const svg = target
    ? await QRCode.toString(target, {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 1,
        // Plain dark-on-white. Brand colour here would only cost scan
        // reliability at distance, which is the entire job of this page.
        color: { dark: "#0F1B2D", light: "#FFFFFF" },
      })
    : null;

  return (
    <div className="flex flex-col gap-5">
      <PageTitle subtitle="Point a phone camera at the code to follow Camille, Miguel, and Grace live.">
        Scan to follow the recovery
      </PageTitle>

      {!target ? (
        <Card className="border-bad-line bg-bad-soft p-5">
          <p className="text-[14px] font-semibold text-bad">
            No network address found.
          </p>
          <p className="mt-1 text-[14px] text-ink-soft">
            The laptop does not appear to be on wi-fi. Connect it to a network —
            or to a phone&apos;s hotspot — and reload.
          </p>
        </Card>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[auto_1fr]">
          <Card className="flex flex-col items-center gap-4 p-6">
            {/* Sized so it scans from a few metres, which is the point. */}
            <div
              className="h-[300px] w-[300px] [&>svg]:h-full [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: svg! }}
              role="img"
              aria-label={`QR code for ${target}`}
            />
            <p className="tnum break-all text-center font-mono text-[14px] font-semibold text-ink">
              {target}
            </p>
          </Card>

          <div className="flex flex-col gap-4">
            <Card className="p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Eyebrow>Before you rely on this</Eyebrow>
                {isTunnel ? (
                  <Chip tone="ok">Public tunnel — works on cellular</Chip>
                ) : (
                  <Chip tone="warn">Same wi-fi required</Chip>
                )}
              </div>
              <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-[14px] text-ink-soft">
                <li>
                  Start the server with{" "}
                  <code className="rounded bg-surface-alt px-1.5 py-0.5 font-mono text-[13px]">
                    npm run dev:lan
                  </code>
                  . The plain{" "}
                  <code className="rounded bg-surface-alt px-1.5 py-0.5 font-mono text-[13px]">
                    npm run dev
                  </code>{" "}
                  binds to localhost only, and no phone can reach it.
                </li>
                <li>
                  The scanning phone must be on the{" "}
                  <b className="text-ink">same network as this laptop</b>.
                </li>
                <li>
                  <b className="text-ink">Test one phone before the room fills.</b>{" "}
                  Many campus networks isolate clients, so devices cannot see
                  each other even on the same wi-fi.
                </li>
              </ol>
            </Card>

            <Card className="p-5">
              <Eyebrow>If phones cannot load it</Eyebrow>
              <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-[14px] text-ink-soft">
                <li>
                  <b className="text-ink">Hotspot.</b> Turn on your phone&apos;s
                  hotspot, join the laptop to it, reload this page for the new
                  address. Does not depend on venue wi-fi — but everyone
                  scanning has to join that hotspot too.
                </li>
                <li>
                  <b className="text-ink">Public tunnel.</b> Run{" "}
                  <code className="rounded bg-surface-alt px-1.5 py-0.5 font-mono text-[13px]">
                    cloudflared tunnel --url http://localhost:3000
                  </code>
                  , then open{" "}
                  <code className="rounded bg-surface-alt px-1.5 py-0.5 font-mono text-[13px]">
                    /qr?url=&lt;the https link&gt;
                  </code>
                  . Any phone on cellular can then reach it.
                </li>
                <li>
                  <b className="text-ink">No phones at all.</b> Project{" "}
                  <code className="rounded bg-surface-alt px-1.5 py-0.5 font-mono text-[13px]">
                    /live
                  </code>{" "}
                  instead — it is the same read-only live board.
                </li>
              </ul>
            </Card>

            {addresses.length > 1 && !isTunnel && (
              <Card className="p-5">
                <Eyebrow>Other addresses on this machine</Eyebrow>
                <ul className="mt-2 flex flex-col gap-1">
                  {addresses.slice(1).map((a) => (
                    <li key={a.address} className="text-[14px] text-muted">
                      <span className="tnum font-mono">{a.address}</span> ·{" "}
                      {a.name}
                      {!a.likelyReachable && " — virtual adapter, unlikely"}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
