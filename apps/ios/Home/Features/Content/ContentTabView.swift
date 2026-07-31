//
//  ContentTabView.swift
//  Home
//
//  Entry point for the three publishable collections managed by the site.
//

import SwiftUI

struct ContentTabView: View {
    private enum Route: Hashable {
        case projects
        case labs
        case posts
    }

    @Environment(HomeAppModel.self) private var model
    @State private var hasLoaded = false

    var body: some View {
        NavigationStack {
            List {
                if !hasLoaded && model.projects.isEmpty && model.labs.isEmpty && model.posts.isEmpty {
                    Section {
                        HStack {
                            Spacer()
                            ProgressView("Loading content…")
                            Spacer()
                        }
                    }
                }

                if let error = model.lastErrorMessage {
                    Section {
                        ContentInlineError(message: error)
                    }
                }

                Section("Publishable content") {
                    NavigationLink(value: Route.projects) {
                        ContentCollectionRow(
                            title: "Projects",
                            subtitle: "Case studies, media and featured order",
                            systemImage: "rectangle.stack",
                            count: model.projects.count,
                            publishedCount: model.projects.lazy.filter(\.published).count
                        )
                    }

                    NavigationLink(value: Route.labs) {
                        ContentCollectionRow(
                            title: "Labs",
                            subtitle: "Repositories, links and live stats",
                            systemImage: "hammer",
                            count: model.labs.count,
                            publishedCount: model.labs.lazy.filter(\.published).count
                        )
                    }

                    NavigationLink(value: Route.posts) {
                        ContentCollectionRow(
                            title: "Posts",
                            subtitle: "Markdown, covers and tags",
                            systemImage: "doc.richtext",
                            count: model.posts.count,
                            publishedCount: model.posts.lazy.filter(\.published).count
                        )
                    }
                }
            }
            .navigationTitle("Content")
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .projects:
                    ProjectsScreen()
                case .labs:
                    LabsScreen()
                case .posts:
                    PostsScreen()
                }
            }
            .refreshable {
                await refresh()
            }
            .task {
                guard !hasLoaded else { return }
                await refresh()
            }
        }
    }

    private func refresh() async {
        model.clearError()
        await model.refreshSubscriptions()
        hasLoaded = true
    }
}

private struct ContentCollectionRow: View {
    let title: String
    let subtitle: String
    let systemImage: String
    let count: Int
    let publishedCount: Int

    var body: some View {
        HStack(spacing: HorizonStyle.stack) {
            Image(systemName: systemImage)
                .font(.title3)
                .frame(width: 28)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: HorizonStyle.snug) {
                Text(title)
                    .font(.headline)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: HorizonStyle.snug) {
                Text(count, format: .number)
                    .font(HorizonStyle.mono(.headline))
                    .horizonNumerals()
                Text("\(publishedCount) live")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, HorizonStyle.snug)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title), \(count) total, \(publishedCount) published")
    }
}
