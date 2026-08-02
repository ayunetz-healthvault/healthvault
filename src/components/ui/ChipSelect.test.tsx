import { fireEvent, render, screen } from '@testing-library/react-native';

import { ChipSelect } from './ChipSelect';

const OPTIONS = [
  { value: 'mother' as const, label: 'Mother' },
  { value: 'father' as const, label: 'Father' },
];

describe('ChipSelect', () => {
  it('renders every option', async () => {
    await render(
      <ChipSelect label="Relationship" options={OPTIONS} value="mother" onChange={jest.fn()} />,
    );

    expect(screen.getByText('Mother')).toBeTruthy();
    expect(screen.getByText('Father')).toBeTruthy();
  });

  it('reports the selected option to screen readers', async () => {
    await render(
      <ChipSelect
        label="Relationship"
        options={OPTIONS}
        value="mother"
        onChange={jest.fn()}
        testID="rel"
      />,
    );

    expect(screen.getByTestId('rel-mother').props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(screen.getByTestId('rel-father').props.accessibilityState).toMatchObject({
      selected: false,
    });
  });

  it('emits the value when an option is tapped', async () => {
    const onChange = jest.fn();
    await render(
      <ChipSelect
        label="Relationship"
        options={OPTIONS}
        value="mother"
        onChange={onChange}
        testID="rel"
      />,
    );

    await fireEvent.press(screen.getByTestId('rel-father'));

    expect(onChange).toHaveBeenCalledWith('father');
  });

  it('uses the radio role so the group is announced correctly', async () => {
    await render(
      <ChipSelect
        label="Relationship"
        options={OPTIONS}
        value="mother"
        onChange={jest.fn()}
        testID="rel"
      />,
    );

    expect(screen.getByTestId('rel-mother').props.accessibilityRole).toBe('radio');
  });

  it('shows an error in place of the hint', async () => {
    await render(
      <ChipSelect
        label="Relationship"
        options={OPTIONS}
        value="mother"
        onChange={jest.fn()}
        hint="Pick one"
        error="Choose a relationship"
      />,
    );

    expect(screen.getByText('Choose a relationship')).toBeTruthy();
    expect(screen.queryByText('Pick one')).toBeNull();
  });
});
