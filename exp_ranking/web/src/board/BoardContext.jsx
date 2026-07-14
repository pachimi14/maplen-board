import { createContext, useContext } from "react";
import { useRankingBoard } from "./useRankingBoard";
import { useHashRoute } from "./useHashRoute";

const BoardContext = createContext(null);

export function BoardProvider({ children }) {
  const route = useHashRoute();
  const board = useRankingBoard(route);
  const value = { ...board, route };
  return <BoardContext.Provider value={value}>{children}</BoardContext.Provider>;
}

export function useBoard() {
  const context = useContext(BoardContext);
  if (!context) {
    throw new Error("useBoard must be used within a BoardProvider");
  }
  return context;
}
