// filepath: /home/aditya/zasper/zasper/ui/src/test/GitCommit.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GitCommit } from '../ide/sidebar/GitPanel/GitCommit';

describe('GitCommit Testing', () => {
    test('GitCommit render', () => {
        const { asFragment } = render(<GitCommit />);
        expect(asFragment()).toMatchSnapshot();
    });

   test('GitCommit input',()=>{ 
    render(<GitCommit />);
    const input = screen.getByPlaceholderText('Enter commit message');
    fireEvent.change(input, { target: { value: 'test' } });
    expect(input.value).toBe('test');
   })

    test('GitCommit button', () => {
     render(<GitCommit />);
     const button = screen.getByRole('button');
     expect(button).toBeInTheDocument();
    });

    test('GitCommit CheckBox',()=>{ 
        render(<GitCommit />);
        const checkbox = screen.getByRole('checkbox');
        expect(checkbox).toBeInTheDocument();
    })
});