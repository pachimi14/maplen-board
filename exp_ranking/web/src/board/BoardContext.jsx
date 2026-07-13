import { createContext, useContext } from "react";
import { useRankingBoard } from "./useRankingBoard";

const BoardContext = createContext(null);

export function BoardProvider({ children }) {
  const board = useRankingBoard();
  return <BoardContext.Provider value={board}>{children}</BoardContext.Provider>;
}

export function useBoard() {
  const context = useContext(BoardContext);
  if (!context) {
    throw new Error("useBoard must be used within a BoardProvider");
  }
  return context;
}
