// W-TR-03 Reading room (S1.7, design §6 C3): the filmstrip of photos A to L, the photo on the bench (58%) and
// the print beds (42%), one status sentence, and the provenance footer. MM-2 "Paper prints itself" plays for
// every live `extract.row` of the recorded Claude run: the band slides to the line, the crop lifts and flies to
// its bed, the handwriting resolves into type, the row prints in pencil and its confidence ring draws. Rows
// start at least 180 ms apart (the stage director), at most eight crops fly at once, and replayed history only
// ever prints still. Nothing here computes money: every figure is the slip's own text (I1).

import type { SeasonSnapshot } from "@fairsplit/contracts";
import { webRoutes } from "@fairsplit/contracts";
import { Glyph, useMotionMode } from "@fairsplit/ui-web";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScreenRoot } from "../../chrome/ScreenRoot.js";
import { useRunEvents, useStageRun } from "../../data/hooks.js";
import { format } from "../../lib/format.js";
import { useMoment } from "../../lib/moment.js";
import { CLAUDE_MODEL } from "../../lib/provenance.js";
import { useShortcut } from "../../lib/shortcuts.js";
import { useOptionalStage } from "../../stage/context.js";
import { useOnline } from "../season/online.js";
import { SeasonMark } from "../season/parts.js";
import { Beds, type Landing } from "./Beds.js";
import { Bench, type BenchZoom, FIT, zoomOnSlip } from "./Bench.js";
import { READING_COPY } from "./copy.js";
import { Filmstrip } from "./Filmstrip.js";
import { type Connector, type Flight, FlightLayer } from "./FlightLayer.js";
import { maxFlights, ROW_AT, ROW_MS } from "./mm2.js";
import {
  benchPhoto,
  earlierPhotos,
  hasStarted,
  isReading,
  photoOfDoc,
  quarantineNotice,
  readCount,
  readingState,
  replayPhotos,
  replayProgress,
  rowsForPhoto,
  slipsOf,
  statusSentence,
} from "./model.js";
import "./reading.css";

function relBox(el: Element, origin: DOMRect) {
  const r = el.getBoundingClientRect();
  return { x: r.left - origin.left, y: r.top - origin.top, width: r.width, height: r.height };
}

/**
 * Runs `fn` once the bench shows `serial`'s anchor: at once when it is already painted, else after React has
 * committed the photo the event switched to (a few short tries; a hidden tab never blocks on a frame).
 */
function whenAnchored(
  root: () => HTMLElement | null,
  serial: string,
  fn: (root: HTMLElement) => void,
  tries = 4,
) {
  const el = root();
  if (el?.querySelector(`[data-anchor="${serial}"]`)) {
    fn(el);
    return;
  }
  if (tries > 0) setTimeout(() => whenAnchored(root, serial, fn, tries - 1), 16);
}

export function ReadingRoom({
  snapshot,
  requested,
}: {
  readonly snapshot: SeasonSnapshot;
  readonly requested: string | undefined;
}) {
  const mode = useMotionMode();
  const stage = useOptionalStage();
  const router = useRouter();
  const { runSlug, view, inSession } = useStageRun();
  const online = useOnline();
  const moment = useMoment("MM-2");
  const [landings, setLandings] = useState<Readonly<Record<string, Landing>>>({});
  const [band, setBand] = useState<string | null>(null);
  const [outline, setOutline] = useState<string | null>(null);
  const [flights, setFlights] = useState<readonly Flight[]>([]);
  const [connectors, setConnectors] = useState<readonly Connector[]>([]);
  const [zoom, setZoom] = useState<BenchZoom>(FIT);
  const [activeRow, setActiveRow] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const season = snapshot.season.label;
  const photo = benchPhoto(snapshot, view, requested) ?? replayPhotos(snapshot)[0];
  const photoId = photo?.photoId ?? "A";
  const slips = useMemo(() => (photo ? slipsOf(snapshot, photo) : []), [snapshot, photo]);
  const rows = photo ? rowsForPhoto({ view, snapshot, photo }) : [];
  const started = hasStarted(view, inSession);
  const reading = isReading(view) || Object.keys(landings).length > 0;

  // The bench and the flights read the latest values from inside timers and event handlers.
  const live = useRef({ photoId, slips, rows, mode, flights: flights.length });
  live.current = { photoId, slips, rows, mode, flights: flights.length };

  const later = useCallback((ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending) clearTimeout(id);
      pending.clear();
    };
  }, []);

  /** A row's MM-2, once its spacing slot comes up: the phase machine, the band, then a flight or a connector. */
  const startRow = useCallback(
    (eventId: string, rowPhotoId: string, serial: string) => {
      moment.play("row", { eventId, kind: "sse" });
      if (rowPhotoId !== live.current.photoId) return;
      setBand(serial);
      whenAnchored(
        () => body.current,
        serial,
        (root) => {
          const origin = root.getBoundingClientRect();
          const anchor = root.querySelector(`[data-anchor="${serial}"]`);
          const target = root.querySelector(`[data-flight-target="${serial}"]`);
          if (!anchor || !target) return;
          const from = relBox(anchor, origin);
          const to = relBox(target, origin);
          const fly = live.current.flights < maxFlights(live.current.mode) && from.width > 0;
          if (fly) {
            const slip = live.current.slips.find((s) => s.slip.serial === serial)?.slip;
            const row = live.current.rows.find((r) => r?.serial === serial);
            if (slip) {
              setFlights((f) => [
                ...f,
                { id: eventId, serial, from, to, slip, text: row?.netKg ?? slip.boxes["8"] },
              ]);
              return;
            }
          }
          // Reduced motion and the low tier: a pencil outline on the crop and a 1 px connector for 600 ms.
          setOutline(serial);
          setConnectors((c) => [
            ...c,
            {
              id: eventId,
              from: { x: from.x + from.width / 2, y: from.y + from.height / 2 },
              to: { x: to.x, y: to.y + to.height / 2 },
            },
          ]);
          later(ROW_AT.flight + ROW_MS.flight, () => setConnectors((c) => c.filter((x) => x.id !== eventId)));
          later(ROW_AT.landed, () => setOutline((o) => (o === serial ? null : o)));
        },
      );
    },
    [moment, later],
  );

  useRunEvents(inSession ? runSlug : null, (event, meta) => {
    if (meta.replay || event.type !== "extract.row") return;
    const rowPhoto = photoOfDoc(snapshot, event.payload.docId);
    if (!rowPhoto) return;
    const serial = event.payload.serial;
    const delay = stage?.director.space("row") ?? 0;
    setLandings((l) => ({ ...l, [serial]: { eventId: event.id, delay } }));
    later(delay, () => startRow(event.id, rowPhoto.photoId, serial));
    later(delay + ROW_AT.landed + ROW_MS.ring, () =>
      setLandings((l) => {
        if (l[serial]?.eventId !== event.id) return l;
        const { [serial]: _done, ...rest } = l;
        return rest;
      }),
    );
  });

  // When the reading is over the band lifts off the photo.
  useEffect(() => {
    if (!reading) setBand(null);
  }, [reading]);

  // A new photo on the bench starts at fit.
  const shownPhoto = useRef(photoId);
  useEffect(() => {
    if (shownPhoto.current === photoId) return;
    shownPhoto.current = photoId;
    setZoom(FIT);
    setActiveRow(null);
  }, [photoId]);

  const onFlightDone = useCallback((id: string) => setFlights((f) => f.filter((x) => x.id !== id)), []);

  const moveRow = (delta: number) => {
    const serials = slips.map((s) => s.slip.serial);
    const index = Math.max(0, serials.indexOf(activeRow ?? serials[0] ?? ""));
    const nextSerial = serials[Math.min(serials.length - 1, Math.max(0, index + delta))];
    if (!nextSerial) return;
    setActiveRow(nextSerial);
    tableRef.current?.querySelector<HTMLElement>(`[data-serial="${nextSerial}"]`)?.focus();
  };
  useShortcut({
    id: "reading.next-row",
    keys: "J",
    label: "Next row",
    group: "Read",
    scope: tableRef,
    run: () => moveRow(1),
  });
  useShortcut({
    id: "reading.prev-row",
    keys: "K",
    label: "Previous row",
    group: "Read",
    scope: tableRef,
    run: () => moveRow(-1),
  });

  if (!photo) return null;
  const offline = !online;
  const state = readingState({
    photo,
    started,
    reading,
    rows,
    offline,
    aiPaused: view?.flags.kill_ai_live === true,
  });
  const sentence = statusSentence({ photo, rows, reading, started, snapshot });
  const film = replayPhotos(snapshot).map((p) => {
    const r = rowsForPhoto({ view, snapshot, photo: p });
    return {
      photo: p,
      slips: slipsOf(snapshot, p),
      read: r.length > 0 && readCount(r) === r.length,
      pending: r.some((x) => x !== null && x.pending.length > 0),
    };
  });
  const treasurer = snapshot.officers.find((o) => o.role === "TREASURER") ?? null;
  const recorded = format.dateShort(snapshot.run.recordedOn);
  const footer =
    photo.set === "EARLIER" && photo.readOn
      ? READING_COPY.earlierFooter(format.date(photo.readOn))
      : READING_COPY.footer(CLAUDE_MODEL, recorded);

  return (
    <ScreenRoot id="W-TR-03" state={state} labelledBy="fsc-read-title" className="fsc-read">
      <header className="fsc-read__head">
        <div className="fsc-read__titles">
          <SeasonMark snapshot={snapshot} testId="W-TR-03.mark" />
          <h1 id="fsc-read-title" className="fs-t-title-1">
            {READING_COPY.title}
          </h1>
        </div>
      </header>

      <div
        className="fsc-read__body"
        ref={body}
        {...moment.rootProps}
        data-motion={mode}
        data-testid="W-TR-03.room"
      >
        <Bench
          photo={photo}
          slips={slips}
          band={band}
          outline={outline}
          zoom={zoom}
          onZoom={setZoom}
          mode={mode}
          testId="W-TR-03.bench"
        />
        <div className="fsc-read__side">
          <p className="fsc-read__status" role="status" data-testid="W-TR-03.status" data-state={state}>
            <Glyph
              name={state === "reading" ? "pencil" : state === "offline" ? "ms:wifi-off" : "triplicate-slip"}
              size={16}
            />
            <span>
              {sentence}
              {state === "offline" && ` ${READING_COPY.stateOffline}`}
              {state === "live-paused" && ` ${READING_COPY.stateLivePaused}`}
            </span>
          </p>
          <Filmstrip
            season={season}
            replay={film}
            earlier={earlierPhotos(snapshot)}
            active={photo.photoId}
            progress={replayProgress(view, snapshot)}
            testId="W-TR-03.film"
          />
          <Beds
            season={season}
            photoId={photo.photoId}
            slips={slips}
            rows={rows}
            landings={landings}
            active={activeRow}
            onActive={setActiveRow}
            onOpenCrop={(serial) => {
              const s = slips.find((x) => x.slip.serial === serial);
              if (s) setZoom(zoomOnSlip(s.position));
            }}
            onByHand={(serial) => router.history.push(webRoutes.byHand(season, serial))}
            tableRef={tableRef}
            started={started || photo.set === "EARLIER"}
            treasurer={treasurer}
            notice={(serial) => quarantineNotice(snapshot, serial)}
            testId="W-TR-03.beds"
          />
        </div>
        <FlightLayer flights={flights} connectors={connectors} onDone={onFlightDone} />
      </div>

      <footer className="fsc-read__footer fs-t-caption" data-testid="W-TR-03.footer">
        <Glyph name="pencil" size={14} />
        <span>{footer}</span>
      </footer>
    </ScreenRoot>
  );
}
