import { AvatarPreview, resolveLook, type AvatarOwner } from "../lib/avatarKit";
import { photoUrl } from "../lib/avatarStore";

type Props = {
  user: AvatarOwner;
  size: number;
  /** the whole standing figure instead of the round headshot */
  full?: boolean;
};

/** anyone's saved avatar. the signed-in user's own editable one comes from
 * `useAvatarState` instead, so it tracks edits before they've been saved */
export default function UserAvatar({ user, size, full = false }: Props) {
  const { tone, head, shirt } = resolveLook(user.avatar);
  const figure = (
    <AvatarPreview
      tone={tone}
      photo={user.avatar_path ? photoUrl(user.avatar_path) : null}
      head={head}
      shirt={shirt}
      size={size}
      crop={!full}
    />
  );
  if (full) return figure;

  return (
    <span className="pfp" style={{ width: size, height: size }} aria-hidden>
      {figure}
    </span>
  );
}
