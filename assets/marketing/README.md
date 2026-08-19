# Marketing assets

Where campaign imagery lives, and the convention that lets the marketing agent
work with it without being walked through it every time.

## Layout

```
assets/marketing/
  README.md          this file, committed
  MANIFEST.md        what each asset is and where it may be used — committed
  originals/         the licensed or shot files themselves — GITIGNORED
```

**`originals/` is gitignored on purpose.** Licensed stock must not sit in git
history: the licence is to Abniyah, not to anyone who clones the repo, and
history is forever even after a delete. Photos of real people and real
buildings do not belong there either.

So the repo remembers *what we have and what we may do with it*; the files
themselves live on the machine and in whatever backup you already keep.

## MANIFEST.md

One entry per asset. Without this the agent has to open every file to learn
anything, and it still would not know the licence.

```markdown
### drawer-receipts-01.jpg
- **Source:** Adobe Stock #123456789 (standard licence, 2026-08-07)
- **Release:** n/a (no identifiable person)
- **Used in:** teaser reel, beat 1 · square ad "Where did the receipt go?"
- **Notes:** busy top third, works best cropped to the lower two thirds
```

`Release` is the field that matters for paid ads. If an identifiable face
appears and there is no release on file, the asset does not go in an ad.

## Finding candidates

```bash
node scripts/stock-search.mjs "receipts drawer" --vertical --limit 12
```

Returns id, title, aspect ratio, photographer, release status and a preview
URL. It cannot license or download: that spends money or creates a licence
obligation, and both are Jey's call.

**Sources, and which to use when:**

- **Pexels (default).** Free API key, issued instantly at pexels.com/api, no
  approval. Right for the **object and hands shots** the Abniyah ads use.
- **Adobe Stock (`--source adobe`).** Needs the Stock API **enterprise**
  entitlement; a self-service subscription, trial included, does not have it
  and the Developer Console answers "License required". Adobe is still where
  you go for **anything with an identifiable face**, because they supply model
  releases and indemnification. Just license those by hand on the website.

The split follows the risk, not convenience: free stock verifies no model
releases, so a face from a free source in a paid ad is real exposure. Objects
and hands carry none of that.

## What makes a shot work here

The reel and the square ads all run the same treatment: desaturate, tint into
brand teal, darken top and bottom. Which means:

- **Colour does not survive.** Judge on shape, contrast and light.
- **Keep the middle third quiet.** The headline sits there.
- **High contrast beats pretty.** A soft, evenly lit photo turns to mush.
- **No faces, where possible.** Hands and objects sidestep the release
  question entirely, and read as more universal.
- **Shot in Lebanon beats generic.** It is the one thing foreign competitors
  cannot copy.
