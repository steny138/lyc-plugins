export type Shape = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L'
export type Coord = [number, number]
export type Block = { shape: Shape; origin: Coord; extra: Coord[] }
export type Game = { block: Block; next: Shape; bag: Shape[]; random: number; board: Record<string, Shape>; score: number; lines: number; level: number }
declare module 'claude-code' { interface PluginState { tetris: { game: Game | null } } }
