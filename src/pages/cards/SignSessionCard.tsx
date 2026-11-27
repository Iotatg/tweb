import {createSignal, JSX} from 'solid-js';

import Button from '@components/buttonTsx';
import MediaHeader from '@components/mediaHeader';

import AuthCard from '@/pages/AuthCard';
import AuthCardError from '@/pages/AuthCardError';
import {CardSpec, useAuthFlow} from '@/pages/authFlow';
import styles from '@/pages/authFlow.module.scss';

if(import.meta.hot) import.meta.hot.accept();

type Spec = Extract<CardSpec, {name: 'signSession'}>;

/**
 * Card variant of `pageSignSession`. A Telethon/Pyrogram session string is
 * pasted in and handed to `appAccountManager.importSession`, which writes the
 * auth key it carries and reads the user back from the server. On success we go
 * to IM; on any failure the error is shown under the field.
 */
export default function SignSessionCard(_props: {spec: Spec}) {
  const {managers, toIm} = useAuthFlow();

  const [value, setValue] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<JSX.Element>();

  async function onSubmit(e?: Event) {
    e?.preventDefault();

    const sessionString = value().trim();
    if(!sessionString || submitting()) {
      return;
    }

    setSubmitting(true);
    setError(undefined);

    try {
      await managers.appAccountManager.importSession(sessionString);
      await toIm();
    } catch(err) {
      setError((err as Error).message || 'Invalid session string');
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      header={
        <MediaHeader>
          <MediaHeader.Sticker
            class={styles.logoContainer}
            size={120}
            element={
              <svg class={styles.logo} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
                <use href="#logo"/>
              </svg>
            }
          />
          <MediaHeader.Title tag="h1">Sign in with session</MediaHeader.Title>
          <MediaHeader.Subtitle class="secondary">Paste a Telethon or Pyrogram session string.</MediaHeader.Subtitle>
        </MediaHeader>
      }
      inputWrapper={false}
    >
      <div class="input-wrapper">
        <textarea
          class={styles.sessionInput}
          value={value()}
          onInput={(e) => setValue(e.currentTarget.value)}
          placeholder="Paste session string"
          rows={4}
          spellcheck={false}
          dir="ltr"
        />
        <AuthCardError content={error()} />
        <Button
          class="btn-primary btn-color-primary"
          disabled={!value().trim() || submitting()}
          onClick={onSubmit}
        >
          {submitting() ? 'Signing in...' : 'Sign in'}
        </Button>
      </div>
    </AuthCard>
  );
}
