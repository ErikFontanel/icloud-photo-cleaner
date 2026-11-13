"""sift-mac command line."""

import argparse

from . import config, offline, state


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(prog="sift-mac", description="Local companion to Photos.app.")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("setup", help="download models and GeoNames data (the only network step)")
    scan = sub.add_parser("scan", help="analyse photos added or changed since the last scan (read-only)")
    scan.add_argument("--library", help="Photos library path (default: the System Photo Library)")
    sub.add_parser("embed", help="EmbeddingGemma 2 embeddings for undecided junk photos (groups them by content)")
    bench = sub.add_parser("bench", help="score detectors against your labels")
    bench.add_argument("what", choices=["dupes"])
    sub.add_parser("evals", help="run your searches (~/.sift-mac/evals.toml) through Photos' search; the first run is the baseline")
    sub.add_parser("events", help="find events; the local model judges the ones without GPS (Ollama runs only meanwhile)")
    review = sub.add_parser("review", help="serve the review page on 127.0.0.1")
    review.add_argument("--port", type=int, default=8765)
    args = parser.parse_args(argv)

    if args.command == "setup":
        from . import setup

        setup.run()
        return

    offline.enforce()
    db = state.connect(config.state_db())
    if args.command == "scan":
        import osxphotos
        from osxphotos.utils import get_system_library_path

        from .scan import scan as run_scan

        library = args.library or get_system_library_path()
        print(f"Scanning {library}")
        counts = run_scan(osxphotos.PhotosDB(library).photos(), db)
        print(", ".join(f"{k} {v}" for k, v in counts.items()))
    elif args.command == "embed":
        from . import embed

        print(f"Embedded {embed.run(db)} photos.")
    elif args.command == "bench":
        from . import bench as bench_mod

        r = bench_mod.dupes(db)
        print(f"{r['pairs']} labelled pairs, {r['same']} duplicates")
        for name in ("vision", "embeddinggemma-2"):
            m = r[name]
            print(f"  {name:17} F1 {m['f1']:.2f}  precision {m['precision']:.2f}  recall {m['recall']:.2f}  threshold {m['threshold']:.3f}")
        print(f"Winner: {r['winner']} (saved)")
    elif args.command == "evals":
        from . import evals

        for r in evals.run(db):
            print(f"{r['query']:24} baseline {r['baseline']:5}   now {r['now']:5}   +{r['gained']} -{r['lost']}")
    elif args.command == "events":
        from . import events

        kinds = events.judge_all(db)
        print("Judged: " + (", ".join(f"{k} {v}" for k, v in kinds.items()) or "nothing new"))
    elif args.command == "review":
        from .server import make_server

        server = make_server(args.port)
        print(f"Review page: http://127.0.0.1:{server.server_address[1]}/  (Ctrl-C to stop)")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
