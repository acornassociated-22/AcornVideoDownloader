/** Inline brand icons for Acorn Associated social links (original brand colors). */

type IconProps = { className?: string };

/** Facebook “f” mark. */
export function IconFacebook({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#1877F2"
        d="M14 8.2h2.2V5H14c-2.4 0-4 1.5-4 4v1.8H8V14h2v6h3.2v-6H15l.5-3.2h-2.3V9c0-.5.3-.8.8-.8Z"
      />
    </svg>
  );
}

/** X (Twitter) mark. */
export function IconX({ className }: IconProps) {
  return (
    <svg className={`${className ?? ""} social-icon-x`} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M13.7 10.7 19.5 4h-1.4l-5 5.8L9.1 4H4.2l6.1 8.9L4.2 20h1.4l5.4-6.2L14.9 20h4.9l-6.1-9.3Zm-1.9 2.2-.6-.9-5-7.1h2.2l4.1 5.8.6.9 5.3 7.5h-2.2l-4.4-6.2Z"
      />
    </svg>
  );
}

/** Instagram camera mark with brand gradient. */
export function IconInstagram({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="acornIgGrad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#f58529" />
          <stop offset="50%" stopColor="#dd2a7b" />
          <stop offset="100%" stopColor="#515bd4" />
        </linearGradient>
      </defs>
      <path
        fill="url(#acornIgGrad)"
        d="M12 7.2A4.8 4.8 0 1 0 12 16.8 4.8 4.8 0 0 0 12 7.2Zm0 7.9a3.1 3.1 0 1 1 0-6.2 3.1 3.1 0 0 1 0 6.2Zm5.1-8.9a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0ZM12 4.4c-1.7 0-1.9 0-2.6.1-.7 0-1.1.1-1.5.3-.4.2-.8.4-1.1.7-.3.3-.5.7-.7 1.1-.2.4-.3.8-.3 1.5 0 .7-.1.9-.1 2.6s0 1.9.1 2.6c0 .7.1 1.1.3 1.5.2.4.4.8.7 1.1.3.3.7.5 1.1.7.4.2.8.3 1.5.3.7 0 .9.1 2.6.1s1.9 0 2.6-.1c.7 0 1.1-.1 1.5-.3.4-.2.8-.4 1.1-.7.3-.3.5-.7.7-1.1.2-.4.3-.8.3-1.5 0-.7.1-.9.1-2.6s0-1.9-.1-2.6c0-.7-.1-1.1-.3-1.5a3 3 0 0 0-.7-1.1 3 3 0 0 0-1.1-.7c-.4-.2-.8-.3-1.5-.3-.7 0-.9-.1-2.6-.1Zm0-1.6c1.7 0 2 0 2.7.1.8 0 1.4.2 1.9.4.5.2 1 .5 1.4.9.4.4.7.9.9 1.4.2.5.3 1.1.4 1.9.1.7.1 1 .1 2.7s0 2-.1 2.7c0 .8-.2 1.4-.4 1.9-.2.5-.5 1-.9 1.4-.4.4-.9.7-1.4.9-.5.2-1.1.3-1.9.4-.7.1-1 .1-2.7.1s-2 0-2.7-.1c-.8 0-1.4-.2-1.9-.4a3.8 3.8 0 0 1-1.4-.9 3.8 3.8 0 0 1-.9-1.4c-.2-.5-.3-1.1-.4-1.9-.1-.7-.1-1-.1-2.7s0-2 .1-2.7c0-.8.2-1.4.4-1.9.2-.5.5-1 .9-1.4.4-.4.9-.7 1.4-.9.5-.2 1.1-.3 1.9-.4.7-.1 1-.1 2.7-.1Z"
      />
    </svg>
  );
}

/** YouTube play mark. */
export function IconYoutube({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#FF0000"
        d="M22.5 7.2a2.9 2.9 0 0 0-2-2C18.7 4.7 12 4.7 12 4.7s-6.7 0-8.5.5a2.9 2.9 0 0 0-2 2A30 30 0 0 0 1 12a30 30 0 0 0 .5 4.8 2.9 2.9 0 0 0 2 2c1.8.5 8.5.5 8.5.5s6.7 0 8.5-.5a2.9 2.9 0 0 0 2-2A30 30 0 0 0 23 12a30 30 0 0 0-.5-4.8ZM9.8 15.3V8.7L15.7 12l-5.9 3.3Z"
      />
    </svg>
  );
}

/** Telegram paper-plane mark. */
export function IconTelegram({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#26A5E4"
        d="M21.7 4.4c-.2-.2-.5-.2-.9-.1L3.2 11c-.5.2-.5.5-.1.6l4.3 1.4 1.7 5.3c.1.4.3.5.6.5.2 0 .3 0 .5-.2l2.4-2.3 4.5 3.3c.4.3.8.1.9-.3l3.1-14.4c.1-.4 0-.7-.4-.9ZM8.5 13.1l8.4-5.2c.2-.1.3 0 .2.1l-6.9 6.3-.3 3.3-1.4-4.5Z"
      />
    </svg>
  );
}

/** LinkedIn “in” mark. */
export function IconLinkedin({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#0A66C2"
        d="M6.3 9.2H3.5V20h2.8V9.2ZM4.9 4A1.6 1.6 0 1 0 4.9 7.2 1.6 1.6 0 0 0 4.9 4ZM20.5 20h-2.8v-5.6c0-1.5-.5-2.5-1.8-2.5-1 0-1.5.7-1.8 1.3-.1.2-.1.6-.1.9V20H11.2s0-9.4 0-10.8h2.8v1.5c.4-.6 1.1-1.7 2.9-1.7 2.1 0 3.6 1.4 3.6 4.3V20Z"
      />
    </svg>
  );
}

/** GitHub octocat-style mark. */
export function IconGithub({ className }: IconProps) {
  return (
    <svg className={`${className ?? ""} social-icon-github`} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2C6.5 2 2 6.6 2 12.2c0 4.5 2.9 8.3 6.9 9.6.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.5-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.4 1.1 3 .8.1-.7.4-1.1.6-1.3-2.2-.3-4.6-1.2-4.6-5.1 0-1.1.4-2.1 1-2.8-.1-.3-.4-1.3.1-2.7 0 0 .9-.3 2.8 1a9.4 9.4 0 0 1 5.1 0c2-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.7.7 1 1.7 1 2.8 0 4-2.3 4.8-4.6 5.1.4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5 4-1.3 6.9-5.1 6.9-9.6C22 6.6 17.5 2 12 2Z"
      />
    </svg>
  );
}

/** Medium “M” mark. */
export function IconMedium({ className }: IconProps) {
  return (
    <svg className={`${className ?? ""} social-icon-medium`} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4.4 7.3c0-.3-.1-.6-.4-.8L2.2 4.7v-.3h6l4.6 10.2L16.8 4.4h5.7v.3l-1.5 1.4c-.1.1-.2.3-.2.5v10.5c0 .2.1.4.2.5l1.5 1.4v.3h-7.5v-.3l1.5-1.5c.2-.1.2-.2.2-.5V8.8l-4.3 10.9h-.6L5.4 8.8v7.4c0 .3.1.7.3 1l1.9 2.3v.3H2v-.3l1.9-2.3c.2-.3.3-.7.5-1V7.3Z"
      />
    </svg>
  );
}

/** Reddit alien mark (simplified). */
export function IconReddit({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#FF4500"
        d="M14.2 3.4a1.1 1.1 0 0 0-1 .7l-.9 2.8c-1.7.1-3.3.6-4.6 1.5a2.3 2.3 0 1 0-2.4 3.7 5.7 5.7 0 0 0-.3 1.8c0 3.1 3.5 5.6 7.9 5.6s7.9-2.5 7.9-5.6c0-.6-.1-1.2-.3-1.8a2.3 2.3 0 1 0-2.4-3.7 8.2 8.2 0 0 0-4.2-1.4l.8-2.5h2.4a1.5 1.5 0 1 0 0-1.1h-2.9Zm-3.7 8.6a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4Zm5 0a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4Zm-5.5 3.6c.7.7 1.8 1.1 3 1.1s2.3-.4 3-1.1a.6.6 0 0 1 .8.8c-.9.9-2.3 1.4-3.8 1.4s-2.9-.5-3.8-1.4a.6.6 0 1 1 .8-.8Z"
      />
    </svg>
  );
}

/** Pinterest “P” mark. */
export function IconPinterest({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#E60023"
        d="M12 2C6.5 2 2 6.5 2 12c0 4.2 2.6 7.8 6.3 9.2-.1-.8-.2-2 0-2.9.2-.8 1.3-5.4 1.3-5.4s-.3-.7-.3-1.6c0-1.5.9-2.6 2-2.6.9 0 1.4.7 1.4 1.6 0 1-.6 2.4-.9 3.7-.3 1.1.5 2 1.6 2 1.9 0 3.2-2.4 3.2-5.3 0-2.2-1.5-3.8-4.2-3.8-3 0-4.9 2.3-4.9 4.8 0 .9.3 1.5.7 2 .2.1.2.2.1.4l-.3 1c-.1.3-.2.4-.5.2-1.4-.6-2-2.2-2-4 0-3 2.5-6.6 7.5-6.6 4 0 6.6 2.9 6.6 6 0 4.1-2.3 7.1-5.6 7.1-1.1 0-2.2-.6-2.5-1.3l-.7 2.6c-.2.9-.8 1.9-1.3 2.6A10 10 0 0 0 12 22c5.5 0 10-4.5 10-10S17.5 2 12 2Z"
      />
    </svg>
  );
}
