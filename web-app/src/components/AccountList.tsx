import type { ReactNode } from "react";
import UserAvatar from "./UserAvatar";
import { displayName, type AccountHit } from "../lib/usersApi";

type Props = {
  results: AccountHit[];
  searching: boolean;
  onPick: (hit: AccountHit) => void;
  empty?: string;
  /** something to do with this account, at the end of its row ("add friend").
   * a row with one isn't a link to the account */
  action?: (hit: AccountHit) => ReactNode;
};

export default function AccountList({ results, searching, onPick, empty = "no accounts found", action }: Props) {
  return (
    <ul className="results">
      {results.length === 0 && !searching && <li className="result-empty">{empty}</li>}
      {results.map((u) => {
        const who = (
          <>
            <UserAvatar user={u} size={30} />
            <span className="result-name">{displayName(u) || u.username}</span>
            <span className="result-handle">@{u.username}</span>
          </>
        );
        const control = action?.(u);
        return (
          <li key={u.id}>
            {control ? (
              <div className="result-row">
                {who}
                {control}
              </div>
            ) : (
              <button type="button" onClick={() => onPick(u)}>
                {who}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
