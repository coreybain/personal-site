import type { Project } from "@/lib/snapshot";
import { ProjectPlate } from "./project-plate";

export function ProjectCard({
  project,
  index,
}: {
  project: Project;
  index: number;
}) {
  return (
    <article className="sw-tile">
      <div className="sw-tile-bar" />
      <div className="pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="sw-mono sw-tile-index">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="sw-mono sw-mute">{project.client}</span>
        </div>

        <h3 className="sw-h3 mt-3.5">{project.title}</h3>
        <p className="sw-mono sw-red mt-2">{project.role}</p>

        <div className="mt-5">
          <ProjectPlate index={index} hue={project.accentHue} />
        </div>

        <p className="sw-body mt-5 max-w-[52ch]">{project.summary}</p>

        <ul className="mt-5 flex flex-wrap gap-1.5">
          {project.stack.map((tech) => (
            <li key={tech} className="sw-chip">
              {tech}
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
