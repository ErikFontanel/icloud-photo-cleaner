import Foundation

nonisolated struct MonthKey: Hashable, Comparable, Sendable, Identifiable {
    let year: Int
    let month: Int

    var id: Int { year * 100 + month }

    static func < (lhs: MonthKey, rhs: MonthKey) -> Bool { lhs.id < rhs.id }

    func dateInterval(in calendar: Calendar = .current) -> DateInterval {
        let start = calendar.date(from: DateComponents(year: year, month: month, day: 1))!
        return calendar.dateInterval(of: .month, for: start)!
    }

    var title: String {
        dateInterval().start.formatted(.dateTime.month(.wide))
    }

    var titleWithYear: String {
        dateInterval().start.formatted(.dateTime.month(.wide).year())
    }
}

nonisolated struct LibraryItem: Sendable, Equatable {
    let id: String
    let date: Date
}

/// Library grouped by month. Items inside a month are oldest first.
nonisolated struct MonthIndex: Sendable, Equatable {
    private(set) var items: [MonthKey: [String]] = [:]

    var months: [MonthKey] { items.keys.sorted(by: >) }
    var years: [Int] { Array(Set(items.keys.map(\.year))).sorted(by: >) }
    var totalCount: Int { items.values.reduce(0) { $0 + $1.count } }

    func months(in year: Int) -> [MonthKey] {
        months.filter { $0.year == year }
    }

    func ids(in month: MonthKey) -> [String] { items[month] ?? [] }

    static func build(from library: [LibraryItem], calendar: Calendar = .current) -> MonthIndex {
        var grouped: [MonthKey: [LibraryItem]] = [:]
        for item in library {
            let parts = calendar.dateComponents([.year, .month], from: item.date)
            let key = MonthKey(year: parts.year!, month: parts.month!)
            grouped[key, default: []].append(item)
        }
        var index = MonthIndex()
        for (key, list) in grouped {
            index.items[key] = list.sorted { $0.date < $1.date }.map(\.id)
        }
        return index
    }

    /// The month after `month` (going back in time) that still has undecided items.
    func nextMonth(after month: MonthKey, isComplete: (MonthKey) -> Bool) -> MonthKey? {
        months.first { $0 < month && !isComplete($0) }
    }
}
