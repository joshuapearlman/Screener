# Clear FCF Screener

A from-scratch, Vercel-ready normalized free-cash-flow idea screener. Yahoo Finance changing lists generate possible ideas; official SEC Company Facts provide six to ten years of annual financial evidence.

## What it includes

- Automatic progressive idea finder using six changing Yahoo screener lists
- Manual comma-, space-, or line-separated screening for up to 50 tickers
- Detailed single-company reports
- Aggregate-margin, median-margin, and conservative normalized FCF
- P/nFCF, EV/nFCF, FCF yield, debt, dilution, SBC, and reliability checks
- Stop/resume through browser storage
- CSV export
- No database and no npm dependencies

## Deploy to Vercel

1. Put this folder in a GitHub repository.
2. Import that repository into Vercel.
3. Add `SEC_USER_AGENT` in Vercel Project Settings → Environment Variables. Use a descriptive value with a real contact email, for example `ClearFCFScreener/1.0 you@example.com`.
4. Deploy. No build command or framework preset is required.

## Run locally

Requires Node 20 or newer.

```bash
npm start
```

Open `http://localhost:3000`.

## Test

```bash
npm test
```

## Default idea filter

A stock becomes an `Idea` when it:

- is not a bank or insurer based on SEC SIC;
- has a USD quote;
- has at least six usable annual periods;
- has Medium or High FCF reliability;
- has conservative P/nFCF at or below 15x;
- has net debt/nFCF at or below 5x when calculable; and
- has share-count growth at or below 20% when calculable.

`Review` and `Excluded` results remain visible in manual screens. The automatic finder retains only `Idea` results.

## Data caveats

Yahoo's endpoints are unofficial and can change or rate-limit requests. They are isolated in `lib/yahoo.js`. SEC XBRL filings can contain company-specific tagging and restatements; the app reports the chosen tags and requires sufficient usable history. Always verify figures in the linked filing.
