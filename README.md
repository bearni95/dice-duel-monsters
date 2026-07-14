# Dice Guardians 26

> A fresh take on an old game and initiative

- re-use yugioh cards: imagery, stats (before conversion)
- cards get attack dice, and a defense threshold, like in the one piece board game
- movement is driven by level
- summmon is done with a dice pool, and one gets access to their whole deck on each turn, filtered by the available cards

## Game Resources

When playing, each player gets the following resources:

- **EP (Energy Points):** Pool of energy used to summon, move (1 EP per tile) and declare attacks (1EP per attacked declared). Rolled at each player's turn start

## Card Conversion

Cards in the player's deck need conversion from Yu-Gi-Oh. Here are their stats calculations

|    Stat     |              Formula               |                              Usage                               |
| :---------: | :--------------------------------: | :--------------------------------------------------------------: |
|     ATK     |           YGO.ATK / 100            |          Number of d6 this monster uses when attacking           |
|     HP      |           YGO.DEF / 100            |               Number of Hits the monster can take                |
|     DEF     | 3 + YGO.RequiredAttributesForLevel | Number at which, or above, each attacking d6 is considered a Hit |
| Summon Cost |              YGO.LVL               |                 Needed EP to bring to the board                  |

### Effects and Card Types

The bonuses and effects cards could have in this game are quite broad. Generally:

- All effects involving conditional ATK and DEF should be translated into the game
- Same with those creating synergies with the graveyard
- Fusions can be made using polymerization

## Open Matters

1. The system needs a way for trap and spell cards to be translated and used.
   - could keep magic as a whole as a simplified, very yu-gi-oh system, in which one can place trap cards from their hand onto their own terrain, and spells in any terrain, as well as equip those. placing the spell/trap costs 1EP, and activating it, another, enforcing the preservation of EP after turn end
