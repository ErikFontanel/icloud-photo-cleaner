// Apple Maps search for a place name typed in Sift (a venue, a business, an address). Prints up to 5 matches as JSON.
// Only the typed text goes to Apple; Sift runs this when you save a place, never in the background.
import Foundation
import MapKit

let query = CommandLine.arguments.dropFirst().joined(separator: " ")
let request = MKLocalSearch.Request()
request.naturalLanguageQuery = query
request.resultTypes = [.pointOfInterest, .address]
do {
    let response = try await MKLocalSearch(request: request).start()
    let out: [[String: Any]] = response.mapItems.prefix(5).map { item in
        let p = item.placemark
        return [
            "name": item.name ?? "", "locality": p.locality ?? "", "country": p.isoCountryCode ?? "",
            "address": p.title ?? "", "lat": p.coordinate.latitude, "lon": p.coordinate.longitude,
        ]
    }
    print(String(data: try JSONSerialization.data(withJSONObject: out), encoding: .utf8)!)
} catch let e as MKError where e.code == .placemarkNotFound {
    print("[]")
} catch {
    FileHandle.standardError.write("\(error)\n".data(using: .utf8)!)
    exit(1)
}
