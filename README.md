# RPS Gladiator — adaptive fairness + intensity prototype

<p align="center">
  <a href="https://writban.github.io/Rock-Paper-Scissors-Colosseum/"><strong>Play the live prototype</strong></a>
</p>

A browser prototype for an adaptive Rock–Paper–Scissors opponent with a visible commit–reveal fairness system and a second strategic layer: **Light / Standard / Heavy** commitment.

## Why this project exists

A normal adaptive opponent can feel unfair if the player cannot tell whether it predicted their behaviour or simply reacted after seeing their input. This prototype separates those concerns: the opponent commits to its hidden sequence first, then reveals the sequence and nonce after the bout so the player can verify the original SHA-256 commitment.

The game also adds an intensity choice to each Rock, Paper or Scissors action, turning each move into both a symbol choice and a risk/reward decision.

## Combat rules

Each action is a symbol plus an intensity:

- **Light (L)** — *Feint*: ×0.5 force and ×0.5 exposure.
- **Standard (S)** — *Proper attack*: ×1 force and ×1 exposure.
- **Heavy (H)** — *Full weight*: ×2 force and ×2 exposure.

Rock/Paper/Scissors still decides who wins the clash. Damage is then:

`base damage × winner force × loser exposure`

With base damage = 1D, this gives:

- Heavy vs Heavy: 4D to the loser.
- Heavy vs Standard: 2D to the loser.
- Heavy vs Light: 1D to the loser.
- Standard vs Standard: 1D.
- Light vs Light: 0.25D.
- Identical RPS symbols are a clash/draw and deal 0D regardless of intensity.

This makes Heavy a wager rather than a straight upgrade: it can deliver more damage but also exposes the fighter to a larger punish if read correctly.

## Included

- Arena mode: the AI commits its full hidden sequence of symbols **and intensities** before player input.
- Playground mode: the player first commits an intended sequence, then the AI commits. The player can break the AI seal, inspect its locked sequence, alter their actions, and compare the resulting damage against the original intention.
- SHA-256 commitments with random nonces for both sides. The committed payload includes both symbol and intensity (for example `RH,PL,SS`).
- Post-bout verification showing that revealed sequences reproduce the original commitments.
- Adaptive opponent that uses only prior bout history to estimate both move and commitment tendencies.
- Opponent progression: Recruit → Observer → Tactician → Champion.
- Local bout history and prediction-accuracy tracking.
- Peeked/altered actions are not used as the player's behavioural history; the preserved original intention is used instead.
- Migration support for old prototype history: old R/P/S-only actions are treated as Standard attacks.
- Responsive layout for desktop and mobile.

## Run locally

Because the prototype uses the browser Web Crypto API, serve the folder from localhost rather than opening `index.html` directly.

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Important limitation

This version is frontend-only. The commitments are cryptographically verifiable, and the source code makes the ordering inspectable, but a static webpage cannot provide a fully independent proof of *when* its own commitment was created. A production version should move AI commitment generation to a small backend and sign each commitment before accepting the player's current sequence.
