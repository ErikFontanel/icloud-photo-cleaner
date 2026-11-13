import { type Layout, type Step, ThemeButton, ViewNav } from "@/components/view-nav";

type Props = { step?: Step; onStep?: (s: Step) => void; layout?: Layout; onLayout?: (l: Layout) => void; tools?: React.ReactNode; children?: React.ReactNode };

// The bar on top of both pages: where you are, the page's tools, the ground switch and, on the right, Apply.
export function PageHeader({ children, tools, ...nav }: Props) {
  return (
    <header className="flex flex-wrap items-center gap-2">
      <ViewNav {...nav} />
      {tools}
      <ThemeButton />
      {children}
    </header>
  );
}
