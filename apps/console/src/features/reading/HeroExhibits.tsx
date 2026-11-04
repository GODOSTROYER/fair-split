import type { SeasonSnapshot } from "@fairsplit/contracts";
import { heroExhibits } from "./exhibits.js";
import "./reading.css";

export function HeroExhibits({ snapshot }: { readonly snapshot: SeasonSnapshot }) {
  const exhibits = heroExhibits(snapshot);
  if (exhibits.length === 0) return null;
  return (
    <section className="fsc-heroes" aria-labelledby="fsc-heroes-title" data-testid="W-TR-03.heroes">
      <h2 id="fsc-heroes-title" className="fs-t-title-2" tabIndex={-1}>
        Ten hero slips: the recorded exhibit
      </h2>
      <p className="fs-t-caption">
        All images are AI-generated, synthetic hero flats. Provisional: agent-checked labels, not reviewed by
        a person. These readings are a separate exhibit. The hold cards and the pay run use the seed stand-in,
        not these readings.
      </p>
      <div className="fsc-heroes__grid">
        {exhibits.map((tile) => (
          <article key={tile.id} className="fsc-heroes__tile" data-testid={`W-TR-03.hero.${tile.id}`}>
            <h3 className="fs-t-label">{tile.title}</h3>
            <img
              src={`/media/${tile.image}`}
              alt={`${tile.title}. AI-generated, synthetic sample.`}
              loading="lazy"
            />
            <p className="fs-t-caption">Claude's real reading of this slip, recorded 1 Nov 2026</p>
            <p className="fs-t-caption">Provisional: agent-checked labels. AI-generated, synthetic image.</p>
            <dl className="fsc-heroes__comparison fs-t-caption">
              <div>
                <dt>Recorded net kg (A / B)</dt>
                <dd>
                  {tile.reading.find((field) => field.field === "net_kg")?.a} /{" "}
                  {tile.reading.find((field) => field.field === "net_kg")?.b}
                </dd>
              </div>
              <div>
                <dt>Seed stand-in, not a Claude recording</dt>
                <dd>
                  {tile.reading.find((field) => field.field === "net_kg")?.standIn ??
                    "No stand-in for this slip"}{" "}
                  net kg
                </dd>
              </div>
            </dl>
            <details>
              <summary className="fs-link fs-t-caption">Compare both readings with the seed stand-in</summary>
              <div className="fsc-heroes__table-scroll">
                <table className="fs-t-caption">
                  <caption>
                    Seed stand-in, not a Claude recording. A dash means no stand-in for this field.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Field</th>
                      <th scope="col">Read A</th>
                      <th scope="col">Read B</th>
                      <th scope="col">Zoom</th>
                      <th scope="col">Seed stand-in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tile.reading.map((field) => (
                      <tr key={field.field}>
                        <th scope="row">{field.field.replaceAll("_", " ")}</th>
                        <td>{field.a}</td>
                        <td>{field.b}</td>
                        <td>{field.zoom ?? "—"}</td>
                        <td>{field.standIn ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}
