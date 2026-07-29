import { snapshot } from "@/lib/snapshot";
import { ProjectArt } from "./ProjectArt";
import { SectionHeader } from "./SectionHeader";
import { countWord } from "./format";

const { projects } = snapshot;

export function FeaturedWork() {
  return (
    <section className="ed-wrap ed-band" id="work">
      <SectionHeader
        index="02"
        label="Selected Work"
        meta={`${projects.length} platforms in production`}
        thesis={
          <>
            Documents, compliance, travel and live auctions &mdash;{" "}
            {countWord(projects.length)} systems other engineers now build on.
          </>
        }
      />

      <div className="ed-work">
        {projects.map((project, i) => (
          <article className="ed-card ed-rise" key={project.slug}>
            <ProjectArt
              hue={project.accentHue}
              variant={i}
              index={String(i + 1).padStart(2, "0")}
            />

            <div className="ed-card-head">
              <h3 className="ed-card-title">{project.title}</h3>
              <p className="ed-caps ed-card-client">
                <b>{project.client}</b>
                {project.role}
              </p>
            </div>

            <p className="ed-card-summary">{project.summary}</p>

            <ul className="ed-stack ed-caps">
              {project.stack.map((tech) => (
                <li key={tech}>{tech}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

export default FeaturedWork;
