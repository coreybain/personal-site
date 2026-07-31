//
//  HomeApp.swift
//  Home — the pocket admin for coreybaines.com
//

import ClerkKit
import SwiftUI
import UIKit

final class HomeAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // HealthKit relaunches a terminated app specifically so it can recreate
        // observer queries. Install them from process launch, independently of
        // Clerk/network startup and before any SwiftUI scene task is scheduled.
        Task { @MainActor in
            await HealthSyncService.shared.startBackgroundMonitoring()
            await HealthSyncService.shared.syncOnLaunchIfEligible()
        }
        return true
    }
}

@main
struct HomeApp: App {
    @UIApplicationDelegateAdaptor(HomeAppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var model: HomeAppModel
    private let clerk: Clerk?

    init() {
        #if DEBUG && targetEnvironment(simulator)
        let previewMode = ProcessInfo.processInfo.arguments.contains("-HomePreviewMode")
        #else
        let previewMode = false
        #endif

        if !previewMode, let publishableKey = Config.clerkPublishableKey {
            let configuredClerk = Clerk.configure(publishableKey: publishableKey)
            clerk = configuredClerk
        } else {
            clerk = nil
        }
        _model = State(initialValue: HomeAppModel(preview: previewMode))
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if let clerk {
                    RootView()
                        .environment(clerk)
                } else {
                    RootView()
                }
            }
            .environment(model)
            .task {
                await model.start()
            }
            .onOpenURL { url in
                guard let clerk else { return }
                Task { _ = try? await clerk.handle(url) }
            }
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active else { return }
                Task { await model.retryAuthenticationOnForeground() }
            }
        }
    }
}
