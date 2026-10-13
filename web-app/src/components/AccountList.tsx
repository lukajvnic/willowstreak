import UserAvatar from "./UserAvatar";
import { displayName, type AccountHit } from "../lib/usersApi";

type Props = {
  results: AccountHit[];
  searching: boolean;
  onPick: (hit: AccountHit) => void;
};

export default function AccountList({ results, searching, onPick }: Props) {
  return (
    <ul className="results">
      {results.length === 0 && !searching && <li className="result-empty">no accounts found</li>}
      {results.map((u) => {
        const name = displayName(u) || u.username;
        return (
          <li key={u.id}>
            <button type="button" onClick={() => onPick(u)}>
              <UserAvatar user={u} size={30} />
              <span className="result-name">{name}</span>
              <span className="result-handle">@{u.username}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
