import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PRODUCTS_PER_PAGE, Results } from "./Results";
import type { Product } from "../lib/ucp/types";

const inr = (amountMinor: number) => ({ amountMinor, currency: "INR" });

/**
 * The demo store's shape: one product with three colours, one with none.
 * Before the detail screen existed the grid rendered the t-shirt as three
 * separate cards.
 */
const PRODUCTS: Product[] = [
  {
    id: "gid://shopify/Product/1",
    title: "short sleeve t-shirt",
    handle: "short-sleeve-t-shirt",
    imageUrl: "https://cdn.shopify.com/a.jpg",
    description: "A soft cotton tee.",
    priceRange: { min: inr(120000), max: inr(140000) },
    variants: [
      {
        id: "v-red",
        title: "Red",
        price: inr(120000),
        listPrice: inr(120000),
        available: true,
        imageUrl: "https://cdn.shopify.com/a.jpg",
        options: [{ name: "Color", label: "Red" }],
      },
      {
        id: "v-blue",
        title: "Blue",
        price: inr(130000),
        listPrice: inr(130000),
        available: true,
        options: [{ name: "Color", label: "Blue" }],
      },
      {
        id: "v-black",
        title: "Black",
        price: inr(140000),
        listPrice: inr(140000),
        available: false,
        options: [{ name: "Color", label: "Black" }],
      },
    ],
  },
  {
    id: "gid://shopify/Product/2",
    title: "Sold Out Hoody",
    handle: "sold-out-hoody",
    description: "Heavyweight fleece.",
    priceRange: { min: inr(250000), max: inr(250000) },
    variants: [
      {
        id: "v-hoody",
        title: "Default Title",
        price: inr(250000),
        listPrice: inr(250000),
        available: false,
        options: [{ name: "Title", label: "Default Title" }],
      },
    ],
  },
];

const CAP: Product = {
  id: "gid://shopify/Product/3",
  title: "Plain Cap",
  handle: "plain-cap",
  description: "One size.",
  priceRange: { min: inr(90000), max: inr(90000) },
  variants: [
    {
      id: "v-cap",
      title: "Default Title",
      price: inr(90000),
      listPrice: inr(90000),
      available: true,
      options: [{ name: "Title", label: "Default Title" }],
    },
  ],
};

const CART = {
  cartId: "c1",
  currency: "INR",
  continueUrl: "https://store.test/c/1",
  lines: [
    {
      lineId: "l1",
      variantId: "v-red",
      title: "Red",
      quantity: 2,
      unitPrice: inr(120000),
      lineSubtotal: inr(240000),
      lineTotal: inr(240000),
    },
  ],
  subtotal: inr(240000),
  total: inr(240000),
};

/** Two colours of the same product — the case a card stepper cannot resolve. */
const MIXED_CART = {
  ...CART,
  lines: [
    CART.lines[0],
    {
      lineId: "l2",
      variantId: "v-blue",
      title: "Blue",
      quantity: 1,
      unitPrice: inr(130000),
      lineSubtotal: inr(130000),
      lineTotal: inr(130000),
    },
  ],
};

/** Enough to page. Sized off PRODUCTS_PER_PAGE, never a literal. */
function manyProducts(count: number): Product[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `gid://shopify/Product/p${i}`,
    title: `Perfume ${i}`,
    handle: `perfume-${i}`,
    imageUrl: "https://cdn.shopify.com/p.jpg",
    description: "",
    priceRange: { min: inr(100000), max: inr(100000) },
    variants: [
      {
        id: `v-${i}`,
        title: "Default Title",
        price: inr(100000),
        listPrice: inr(100000),
        available: true,
        options: [{ name: "Title", label: "Default Title" }],
      },
    ],
  }));
}

const BASE = {
  query: "shirt",
  visibleCount: PRODUCTS_PER_PAGE,
  onShowMore: vi.fn(),
  cart: null,
  busy: false,
  onOpenProduct: vi.fn(),
  onQuantityChange: vi.fn(),
  onViewCart: vi.fn(),
};

describe("Results", () => {
  it("renders one card per product, not one per variant", () => {
    // The demo store's t-shirt is three variants. Before the detail screen
    // existed each was its own card, so one product a buyer thinks of as one
    // thing occupied three tiles.
    render(<Results {...BASE} products={PRODUCTS} />);

    expect(screen.getAllByText("short sleeve t-shirt")).toHaveLength(1);
    expect(screen.queryByText("Red")).toBeNull();
  });

  it("prices a multi-variant product from its cheapest", () => {
    // The card prices one variant, so a bare figure on a product whose other
    // sizes cost more is a number the buyer cannot pay. "from" says which end
    // of the range they are looking at.
    render(<Results {...BASE} products={PRODUCTS} />);

    expect(screen.getByText(/from .*1,200\.00/)).toBeInTheDocument();
  });

  it("shows one price when the variants agree", () => {
    render(<Results {...BASE} products={PRODUCTS} />);

    const hoodyPrice = screen.getByText(/2,500\.00/);
    expect(hoodyPrice.textContent).not.toMatch(/–/);
  });

  it("summarises the options a product offers", () => {
    render(<Results {...BASE} products={PRODUCTS} />);

    expect(screen.getByText("3 colors")).toBeInTheDocument();
  });

  it("pluralises an axis name that does not just take an s", () => {
    // Measured on the live store: the Dolce & Gabbana fragrance has a
    // "Quantity" axis, and gluing an s on the end rendered "2 quantitys"
    // under the card. The axis name is Shopify's; the plural is ours.
    const perfume: Product = {
      id: "gid://shopify/Product/4",
      title: "Light Blue Eau Intense",
      handle: "light-blue-eau-intense",
      description: "Citrus and cedar.",
      priceRange: { min: inr(420000), max: inr(680000) },
      variants: [
        {
          id: "v-50",
          title: "50ml",
          price: inr(420000),
          listPrice: inr(420000),
          available: true,
          options: [{ name: "Quantity", label: "50ml" }],
        },
        {
          id: "v-100",
          title: "100ml",
          price: inr(680000),
          listPrice: inr(680000),
          available: true,
          options: [{ name: "Quantity", label: "100ml" }],
        },
      ],
    };

    render(<Results {...BASE} products={[perfume]} />);

    expect(screen.getByText("2 quantities")).toBeInTheDocument();
  });

  it("does not summarise Shopify's Default Title placeholder", () => {
    // A single-variant product carries { name: "Title", label: "Default
    // Title" }. Summarising it would put "1 titles" under the Hoody.
    render(<Results {...BASE} products={PRODUCTS} />);

    expect(screen.queryByText(/title/i)).toBeNull();
  });

  it("promises only what one tap actually reveals", async () => {
    // The label read "View {remaining} more" while the tap reveals a page.
    // That was accurate while a search returned 12 and a page was 6, and
    // became a lie when SEARCH_LIMIT went to 50: the button offered 44 and
    // delivered 6.
    const many = Array.from({ length: 20 }, (_, i) => ({
      ...CAP,
      id: `gid://shopify/Product/p${i}`,
      title: `Product ${i}`,
    }));

    render(<Results {...BASE} products={many} visibleCount={6} />);

    expect(screen.queryByText(/14 more/)).toBeNull();
    expect(screen.getByRole("button", { name: /view more/i })).toBeInTheDocument();
  });

  it("opens the detail screen for the product tapped", async () => {
    const onOpenProduct = vi.fn();
    render(
      <Results {...BASE} products={PRODUCTS} onOpenProduct={onOpenProduct} />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: /short sleeve t-shirt/i }),
    );

    expect(onOpenProduct).toHaveBeenCalledWith("gid://shopify/Product/1");
  });

  it("badges a product that has variants in the cart", () => {
    // The badge counts the product's variants, so two Reds read as 2 — not as
    // one line.
    render(<Results {...BASE} products={PRODUCTS} cart={CART} />);

    // By label, not by text: the stepper under the same card also renders 2.
    expect(screen.getByLabelText("2 in cart")).toBeInTheDocument();
  });

  it("does not badge a product with nothing in the cart", () => {
    render(<Results {...BASE} products={[PRODUCTS[1]]} cart={CART} />);

    expect(screen.queryByLabelText(/in cart/)).toBeNull();
  });

  it("renders title, formatted price and image", () => {
    render(<Results {...BASE} products={PRODUCTS} />);

    expect(screen.getByText("short sleeve t-shirt")).toBeInTheDocument();
    expect(screen.getByAltText("short sleeve t-shirt")).toHaveAttribute(
      "src",
      "https://cdn.shopify.com/a.jpg",
    );
  });

  it("renders an empty state echoing the query", () => {
    render(<Results {...BASE} products={[]} query="unobtainium" />);

    expect(screen.getByText(/unobtainium/)).toBeInTheDocument();
  });

  it("renders a product with no image without crashing", () => {
    render(<Results {...BASE} products={[PRODUCTS[1]]} />);

    expect(screen.getByText("Sold Out Hoody")).toBeInTheDocument();
  });

  it("shows the cart bar only once there is something in it", () => {
    const { rerender } = render(<Results {...BASE} products={PRODUCTS} />);
    expect(screen.queryByRole("button", { name: /view cart/i })).toBeNull();

    rerender(<Results {...BASE} products={PRODUCTS} cart={CART} />);
    expect(
      screen.getByRole("button", { name: /view cart/i }),
    ).toBeInTheDocument();
  });

  it("adds a single-variant product straight from the card", async () => {
    // The collapse cost the Hoody its one-tap add. A product with one variant
    // has nothing to choose, so making the buyer open a detail screen to pick
    // between one option is a step that exists only because of how the grid is
    // built.
    const onQuantityChange = vi.fn();
    const onOpenProduct = vi.fn();
    render(
      <Results
        {...BASE}
        products={[CAP]}
        onQuantityChange={onQuantityChange}
        onOpenProduct={onOpenProduct}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /^\+ add$/i }));

    expect(onQuantityChange).toHaveBeenCalledWith("v-cap", 1);
    expect(onOpenProduct).not.toHaveBeenCalled();
  });

  it("sends a multi-variant product to the detail screen to be chosen", async () => {
    // A card cannot know the buyer wants Blue, and adding Red on their behalf
    // puts a colour they did not pick into the cart.
    const onQuantityChange = vi.fn();
    const onOpenProduct = vi.fn();
    render(
      <Results
        {...BASE}
        products={[PRODUCTS[0]]}
        onQuantityChange={onQuantityChange}
        onOpenProduct={onOpenProduct}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /^\+ add$/i }));

    expect(onOpenProduct).toHaveBeenCalledWith("gid://shopify/Product/1");
    expect(onQuantityChange).not.toHaveBeenCalled();
  });

  it("steps the one variant a product has in the cart", async () => {
    const onQuantityChange = vi.fn();
    render(
      <Results
        {...BASE}
        products={[PRODUCTS[0]]}
        cart={CART}
        onQuantityChange={onQuantityChange}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: /increase quantity/i }),
    );

    expect(onQuantityChange).toHaveBeenCalledWith("v-red", 3);
  });

  it("labels the stepper with real characters, not escape sequences", () => {
    // Shipped broken: the decrease button rendered the seven characters
    // \u2212 because a JSX text child is text, not a string literal, so the
    // escape was never interpreted. The price range beside it was fine — it
    // lives inside a template literal, where the same escape does work.
    render(<Results {...BASE} products={[PRODUCTS[0]]} cart={CART} />);

    expect(
      screen.getByRole("button", { name: /decrease quantity/i }),
    ).toHaveTextContent("\u2212");
    expect(screen.queryByText(/\\u\d{4}/)).toBeNull();
  });

  it("does not print an escape sequence in the price", () => {
    // Shipped broken once: a bare \u2212 as a JSX text child rendered its six
    // characters. The price line is where that showed.
    render(<Results {...BASE} products={[PRODUCTS[0]]} />);

    expect(screen.queryByText(/\\u\d{4}/)).toBeNull();
  });

  it("refuses to step a product holding two different variants", () => {
    // 1 Red and 1 Blue reads as 2 on the badge. A minus here has to guess
    // which one to take away, and guessing removes an item the buyer did not
    // choose to remove.
    render(<Results {...BASE} products={[PRODUCTS[0]]} cart={MIXED_CART} />);

    expect(
      screen.queryByRole("button", { name: /increase quantity/i }),
    ).toBeNull();
    expect(screen.getByLabelText("3 in cart")).toBeInTheDocument();
  });

  it("disables Add for a sold-out single-variant product", () => {
    render(<Results {...BASE} products={[PRODUCTS[1]]} />);

    expect(screen.getByRole("button", { name: /unavailable/i })).toBeDisabled();
  });

  it("opens the detail screen from the image, not only the Add control", async () => {
    const onOpenProduct = vi.fn();
    render(
      <Results {...BASE} products={[CAP]} onOpenProduct={onOpenProduct} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /plain cap/i }));

    expect(onOpenProduct).toHaveBeenCalledWith("gid://shopify/Product/3");
  });

  it("credits the store and the payment provider in the header", () => {
    render(<Results {...BASE} products={PRODUCTS} storeName="Belvish" />);

    expect(screen.getByText(/2 products/)).toBeInTheDocument();
    expect(screen.getByText(/from Belvish/)).toBeInTheDocument();
    // By label, not by text: the wordmark is the brand pack's letterforms
    // now, so there is no "Cashfree" text node to find.
    expect(screen.getByLabelText("Cashfree")).toBeInTheDocument();
  });

  it("omits the store credit rather than printing an empty one", () => {
    // storeName is absent until a tool result carries it — on ChatGPT the
    // catalog is recovered from /api/shop/search after a reload, and the
    // header must not read "8 products from ".
    render(<Results {...BASE} products={PRODUCTS} />);

    expect(screen.getByText(/2 products/)).toBeInTheDocument();
    expect(screen.queryByText(/from\s*$/)).toBeNull();
  });

  it("badges the saving as a whole percent off the priced variant", () => {
    // ₹1,200 against a ₹1,500 list price is 20% off. Derived from the variant
    // the card actually prices, so the badge and the figure beside it agree.
    const DISCOUNTED = {
      ...PRODUCTS[0],
      variants: [
        {
          ...PRODUCTS[0].variants[0],
          price: inr(120000),
          listPrice: inr(150000),
        },
      ],
      priceRange: { min: inr(120000), max: inr(120000) },
    };
    render(<Results {...BASE} products={[DISCOUNTED]} />);

    expect(screen.getByText("-20%")).toBeInTheDocument();
    expect(screen.getByText(/1,500\.00/)).toBeInTheDocument();
  });

  it("does not badge a product that is not discounted", () => {
    render(<Results {...BASE} products={[CAP]} />);

    expect(screen.queryByText(/^-\d+%$/)).toBeNull();
  });

  it("says so when a product has no image", () => {
    // An empty tile reads as a load still in flight.
    render(<Results {...BASE} products={[PRODUCTS[1]]} />);

    expect(screen.getByText(/no image/i)).toBeInTheDocument();
  });


  describe("paging", () => {
    it("shows only the first page of a long result set", () => {
      // Boundary derived from PRODUCTS_PER_PAGE rather than written out. This
      // asserted "Perfume 5" visible and "Perfume 6" hidden, which silently
      // stopped testing the boundary the moment the page size moved.
      render(<Results {...BASE} products={manyProducts(PRODUCTS_PER_PAGE + 4)} />);

      expect(
        screen.getByText(`Perfume ${PRODUCTS_PER_PAGE - 1}`),
      ).toBeInTheDocument();
      expect(screen.queryByText(`Perfume ${PRODUCTS_PER_PAGE}`)).toBeNull();
    });

    it("still counts the whole result set in the header", () => {
      // The header answers "what did this search find", not "what is on
      // screen". Paging it would make a 14-product search read as 6.
      render(<Results {...BASE} products={manyProducts(PRODUCTS_PER_PAGE + 4)} />);

      expect(
        screen.getByText(`${PRODUCTS_PER_PAGE + 4} products`),
      ).toBeInTheDocument();
    });

    it("offers more when the grid is not showing everything", () => {
      // Was "says how many more there are", asserting /view 8 more/. The
      // count came out of the label when SEARCH_LIMIT went to 50: naming the
      // remainder promised 44 for a tap that reveals 6. What still matters is
      // that the control appears at all.
      render(<Results {...BASE} products={manyProducts(PRODUCTS_PER_PAGE + 4)} />);

      expect(
        screen.getByRole("button", { name: /view more/i }),
      ).toBeInTheDocument();
    });

    it("asks the owner of the count to raise it", async () => {
      // Results holds no paging state of its own. The widget remounts as the
      // buyer scrolls, and a useState here would silently collapse an expanded
      // grid back to six — the same trap ProductDetail documents.
      const onShowMore = vi.fn();
      render(
        <Results {...BASE} products={manyProducts(PRODUCTS_PER_PAGE + 4)} onShowMore={onShowMore} />,
      );

      await userEvent.click(screen.getByRole("button", { name: /view more/i }));

      expect(onShowMore).toHaveBeenCalled();
    });

    it("offers nothing more when everything is already shown", () => {
      render(<Results {...BASE} products={manyProducts(PRODUCTS_PER_PAGE)} />);

      expect(screen.queryByRole("button", { name: /view .* more/i })).toBeNull();
    });

    it("keeps the cart bar out of the scrolling area", () => {
      // The bar carried `sticky bottom-0` and never stuck: it was the last
      // element in flow, so its containing block ended exactly at it and there
      // was no room below to stick to. Bounding the grid gives the widget its
      // own scrollport and puts the bar underneath it, where it stays put.
      const { container } = render(
        <Results
          {...BASE}
          products={manyProducts(PRODUCTS_PER_PAGE + 4)}
          cart={{
            cartId: "c1",
            currency: "INR",
            continueUrl: "https://store.test/c",
            lines: [
              {
                lineId: "l1",
                variantId: "v-0",
                title: "Perfume 0",
                quantity: 1,
                unitPrice: inr(100000),
                lineSubtotal: inr(100000),
                lineTotal: inr(100000),
              },
            ],
            subtotal: inr(100000),
            total: inr(100000),
          }}
        />,
      );

      const bar = screen.getByRole("button", { name: /view cart/i }).parentElement!;
      const scroller = container.querySelector(".overflow-y-auto")!;

      expect(scroller).toBeInTheDocument();
      expect(scroller.contains(bar)).toBe(false);
      expect(scroller.className).toMatch(/max-h-/);
      // Never a viewport unit: the host sizes the widget iframe to its content,
      // so a height relative to that iframe feeds back on itself and collapses
      // the grid to a strip. Measured in Claude with min(60dvh,520px).
      expect(scroller.className).not.toMatch(/dvh|vh\]|svh|lvh/);
    });
  });
});
