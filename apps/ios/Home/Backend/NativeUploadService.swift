//
//  NativeUploadService.swift
//  Home
//
//  Sends one selected image to the site's authenticated server-side
//  UploadThing adapter. The default Clerk token belongs to the web origin;
//  Convex mutations continue to use the separate `convex` JWT template.
//

import ClerkKit
import Foundation
import ImageIO
import UIKit
import UniformTypeIdentifiers

nonisolated struct NativeUploadedImage: Sendable {
    let url: String
    let storageKey: String
    let name: String
    let size: Int
    let contentType: String
    let width: Double?
    let height: Double?
}

nonisolated enum NativeUploadError: LocalizedError, Sendable {
    case noSession
    case emptyFile
    case fileTooLarge
    case unsupportedType
    case missingEndpoint
    case insecureEndpoint
    case invalidResponse
    case server(status: Int, message: String)

    var errorDescription: String? {
        switch self {
        case .noSession:
            "Sign in again before uploading an image."
        case .emptyFile:
            "The selected image is empty."
        case .fileTooLarge:
            "Images must be 4 MB or smaller."
        case .unsupportedType:
            "Only image files can be uploaded."
        case .missingEndpoint:
            "The native upload web origin is not configured."
        case .insecureEndpoint:
            "Image uploads require HTTPS. Only a Simulator may use a loopback HTTP development server."
        case .invalidResponse:
            "The upload server returned an unreadable response."
        case .server(_, let message):
            message
        }
    }
}

nonisolated enum NativeUploadService {
    static let maximumBytes = 4 * 1024 * 1024

    /// Normalise PhotosPicker formats (including HEIC) to a bounded, web-safe
    /// JPEG. ImageIO downsamples while decoding instead of first materialising a
    /// full-resolution bitmap, and all CPU-heavy work stays off the main actor.
    static func preparedJPEG(from sourceData: Data) async throws -> Data {
        try await Task.detached(priority: .userInitiated) {
            try encodeBoundedJPEG(from: sourceData)
        }.value
    }

    /// Camera capture arrives as a `UIImage`. Convert it once on the actor that
    /// owns UIKit state, then hand the immutable bytes to the ImageIO pipeline.
    @MainActor
    static func preparedJPEG(from image: UIImage) async throws -> Data {
        guard let sourceData = image.jpegData(compressionQuality: 0.95) else {
            throw NativeUploadError.unsupportedType
        }
        return try await preparedJPEG(from: sourceData)
    }

    private static func encodeBoundedJPEG(from sourceData: Data) throws -> Data {
        guard let source = CGImageSourceCreateWithData(sourceData as CFData, nil),
              CGImageSourceGetCount(source) > 0
        else {
            throw NativeUploadError.unsupportedType
        }

        let maximumDimensions = [4_096, 3_200, 2_400, 1_800]
        let qualities = [0.88, 0.72, 0.58, 0.44]

        for maximumDimension in maximumDimensions {
            let options: CFDictionary = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceShouldCacheImmediately: true,
                kCGImageSourceThumbnailMaxPixelSize: maximumDimension,
            ] as CFDictionary

            guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options) else {
                continue
            }

            for quality in qualities {
                let encoded = NSMutableData()
                guard let destination = CGImageDestinationCreateWithData(
                    encoded,
                    UTType.jpeg.identifier as CFString,
                    1,
                    nil
                ) else {
                    throw NativeUploadError.unsupportedType
                }

                CGImageDestinationAddImage(
                    destination,
                    image,
                    [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary
                )
                guard CGImageDestinationFinalize(destination) else {
                    throw NativeUploadError.unsupportedType
                }

                let data = encoded as Data
                if data.count <= maximumBytes {
                    return data
                }
            }
        }

        throw NativeUploadError.fileTooLarge
    }

    static func upload(
        data: Data,
        fileName: String,
        contentType: String
    ) async throws -> NativeUploadedImage {
        guard !data.isEmpty else { throw NativeUploadError.emptyFile }
        guard data.count <= maximumBytes else { throw NativeUploadError.fileTooLarge }
        guard contentType.lowercased().hasPrefix("image/") else {
            throw NativeUploadError.unsupportedType
        }
        guard let endpoint = Config.nativeUploadURL else {
            throw NativeUploadError.missingEndpoint
        }

        #if targetEnvironment(simulator)
        let allowsLoopbackHTTP = true
        #else
        let allowsLoopbackHTTP = false
        #endif
        guard endpointIsSecure(endpoint, allowsLoopbackHTTP: allowsLoopbackHTTP) else {
            throw NativeUploadError.insecureEndpoint
        }

        guard let session = await MainActor.run(body: { Clerk.shared.session }),
              let token = try await session.getToken(),
              !token.isEmpty
        else {
            throw NativeUploadError.noSession
        }

        let boundary = "HomeBoundary-\(UUID().uuidString)"
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(
            "multipart/form-data; boundary=\(boundary)",
            forHTTPHeaderField: "Content-Type"
        )
        request.httpBody = multipartBody(
            data: data,
            fileName: sanitisedFileName(fileName),
            contentType: contentType,
            boundary: boundary
        )

        let (responseData, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw NativeUploadError.invalidResponse
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            let failure = try? JSONDecoder().decode(FailureResponse.self, from: responseData)
            throw NativeUploadError.server(
                status: httpResponse.statusCode,
                message: failure?.message ?? "The image upload failed (HTTP \(httpResponse.statusCode))."
            )
        }

        guard let result = try? JSONDecoder().decode(SuccessResponse.self, from: responseData) else {
            throw NativeUploadError.invalidResponse
        }

        let dimensions = UIImage(data: data).map {
            (Double($0.size.width * $0.scale), Double($0.size.height * $0.scale))
        }

        return NativeUploadedImage(
            url: result.file.url,
            storageKey: result.file.storageKey,
            name: result.file.name,
            size: result.file.size,
            contentType: result.file.contentType,
            width: dimensions?.0,
            height: dimensions?.1
        )
    }

    private static func multipartBody(
        data: Data,
        fileName: String,
        contentType: String,
        boundary: String
    ) -> Data {
        var body = Data()
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\n")
        body.append("Content-Type: \(contentType)\r\n\r\n")
        body.append(data)
        body.append("\r\n--\(boundary)--\r\n")
        return body
    }

    private static func sanitisedFileName(_ value: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: ".-_"))
        let scalars = value.unicodeScalars.map { allowed.contains($0) ? Character(String($0)) : "-" }
        let result = String(scalars)
        return result.isEmpty ? "home-upload.jpg" : result
    }

    static func endpointIsSecure(_ endpoint: URL, allowsLoopbackHTTP: Bool) -> Bool {
        if endpoint.scheme?.lowercased() == "https" { return true }
        guard allowsLoopbackHTTP, endpoint.scheme?.lowercased() == "http" else {
            return false
        }
        let host = endpoint.host()?.lowercased()
        return host == "localhost" || host == "127.0.0.1" || host == "::1"
    }

    private struct SuccessResponse: Decodable {
        let file: FileResponse
    }

    private struct FileResponse: Decodable {
        let url: String
        let storageKey: String
        let name: String
        let size: Int
        let contentType: String
    }

    private struct FailureResponse: Decodable {
        let message: String
    }
}

private nonisolated extension Data {
    mutating func append(_ string: String) {
        append(contentsOf: string.utf8)
    }
}
