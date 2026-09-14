import { SkyHead } from "@/components/site/Panel";
import { moreProjectsUrl, resumeProjects } from "@/lib/resumeProjects";

export function PersonalProjects() {
  return (
    <section id="personal-projects" className="res-section scroll-mt-20 pt-16 sm:pt-20">
      <SkyHead index="04" eyebrow="Selected personal projects" title="Independent work." />
      <div className="grid gap-3">
        {resumeProjects.map((project) => (
          <article key={project.name} className="hor-card p-5 sm:p-6">
            <h3 className="hor-h3">{project.name}</h3>
            <p className="res-org mt-2">{project.description}</p>
            <a className="hor-link mt-3 inline-block break-all" href={project.url}>
              {project.url.replace(/^https:\/\//, "").replace(/\/$/, "")}
            </a>
          </article>
        ))}
      </div>
      <p className="hor-micro mt-4">
        A selection of my independent work. <a href={moreProjectsUrl} className="hor-link">More projects and details on my website.</a>
      </p>
    </section>
  );
}
