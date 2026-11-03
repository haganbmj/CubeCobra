import React, { useState } from 'react';

import { Card, CardBody } from './base/Card';
import Link from './base/Link';
import { TabbedView } from './base/Tabs';
import Text from './base/Text';
import TextArea from './base/TextArea';
import ErrorBoundary from './ErrorBoundary';
import Markdown from './Markdown';

interface TextEntryProps {
  name?: string;
  value: string;
  setValue: (value: string) => void;
  maxLength?: number;
  rows?: number;
  showCharacterLimit?: boolean;
  // Forwarded to the Preview tab's Markdown render. Default off; set explicitly by callers backing
  // surfaces that render `[[p1p1:<id>]]` embeds outside the editor too, so the preview matches.
  allowEmbeds?: boolean;
}

const TextEntry: React.FC<TextEntryProps> = ({
  value = '',
  setValue,
  maxLength = 1000,
  rows = 4,
  showCharacterLimit = true,
  allowEmbeds = false,
}) => {
  const [tab, setTab] = useState('0');

  return (
    <>
      <Card>
        <ErrorBoundary>
          <TabbedView
            activeTab={parseInt(tab, 10)}
            tabs={[
              {
                label: 'Source',
                content: (
                  <TextArea
                    name="textarea"
                    maxLength={maxLength}
                    className="w-full markdown-input"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    showCharacterLimit={showCharacterLimit}
                    rows={rows}
                  />
                ),
                onClick: () => setTab('0'),
              },
              {
                label: 'Preview',
                content: (
                  <CardBody>
                    <Markdown markdown={value} allowEmbeds={allowEmbeds} />
                  </CardBody>
                ),
                onClick: () => setTab('1'),
              },
            ]}
          />
        </ErrorBoundary>
      </Card>
      <Text sm italic>
        Having trouble formatting your posts? Check out the{' '}
        <Link href="/wiki/reference/markdown" target="_blank">
          markdown guide
        </Link>
        .
      </Text>
    </>
  );
};

export default TextEntry;
