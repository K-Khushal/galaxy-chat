import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CreditsStatus } from "../components/shell/credits-indicator";

test("Credits notice appears at two or fewer without a BYOK key", () => {
  for (const credits of [0, 1, 2]) {
    const html = renderToStaticMarkup(
      <CreditsStatus data={{ credits, key: null }} />,
    );
    expect(html).toContain(`${credits} Credits left`);
    expect(html).toContain("Add your key to keep chatting.");
  }
  expect(
    renderToStaticMarkup(<CreditsStatus data={{ credits: 3, key: null }} />),
  ).not.toContain("Add your key");
});
test("exhausted Credits with a BYOK key show Using your key", () => {
  const html = renderToStaticMarkup(
    <CreditsStatus data={{ credits: 0, key: {} }} />,
  );
  expect(html).toContain("Using your key");
  expect(html).not.toContain("Add your key");
});
